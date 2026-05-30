/**
 * ClaudeTeam extension entry point (M2-06 — live host ↔ webview bridge).
 *
 * Exports `activate` and `deactivate` per the VS Code extension lifecycle.
 * `activate` is called lazily on `onView:claudeteam.dashboard` (per
 * package.json activationEvents). It:
 *   1. Registers the WebviewViewProvider.
 *   2. On view-resolved: starts the file-watcher loop, wires its emissions
 *      to `postState(webview, state)`, and installs the webview → host
 *      message handlers (`ui:open-transcript`, `ui:open-roster`,
 *      `ui:refresh`).
 *   3. Registers the command palette entries (Refresh, Open Roster, Open
 *      Transcript-of-the-selected-tile) — thin shims around the webview
 *      handlers.
 *
 * The file-watcher loop is gated on view resolution — it does NOT start at
 * activation time, only when the user opens the Activity Bar tile. This
 * preserves the <100ms cold-activation target per
 * `.claude/docs/vscode-extension-conventions.md` § "Activation cost".
 *
 * **Subscription-leak fix (M2-06 absorbed-NIT #1).** Prior to this PR,
 * `onResolved` pushed a fresh `dispose` wrapper onto `context.subscriptions`
 * on every invocation — VS Code calls `resolveWebviewView` on every webview
 * reload (e.g. `Developer: Reload Window`), and the subscription stack would
 * grow unbounded across reload cycles. The fix: hold the prior disposable
 * out-of-band and call its `dispose()` BEFORE rebinding, and only register
 * the cleanup wrapper on `context.subscriptions` ONCE during `activate`.
 *
 * Source: .claude/docs/vscode-extension-conventions.md
 *         .claude/docs/data-sources.md §2 (cwdToSlug for transcript path)
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC2/AC3/AC4/AC5/AC6/AC7(e)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as vscode from "vscode";

import {
  ClaudeTeamViewProvider,
  VIEW_ID,
  type WebviewMessageHandlers,
} from "./view/provider.js";
import { startWatcher, type WatcherHandle } from "./watcher/watcherLoop.js";
import { HiddenMembersStore } from "./state/hiddenMembersStore.js";
import { RemovedMembersStore } from "./state/removedMembersStore.js";
import { startRosterWatcher } from "./roster/rosterWatcher.js";
import { startAgentWatcher } from "./roster/agentWatcher.js";
import { SetupController } from "./setupController.js";
import { registerOpenSettingsCommand } from "./commands/openSettings.js";
import {
  postState,
  postRosterLoaded,
  postSetupConfigSaved,
  postSetupCharacters,
  postSetupDetection,
} from "./messageBus.js";
import { cwdToSlug } from "../shared/slug.js";
import {
  createDiagnosticChannel,
  type DiagnosticChannel,
} from "./diagnostics/output.js";
import {
  createDiagnosticPanelManager,
  type DiagnosticPanelManager,
} from "./diagnostics/panel.js";

/**
 * Called by VS Code when the extension activates (lazy — fires on first
 * `onView:claudeteam.dashboard` event, i.e. when the user opens the Activity
 * Bar tile for the first time). Keep this fast (<100ms target).
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ClaudeTeamViewProvider(context.extensionUri);

  // E-06a (EPIC 86ca11187 §7.2): persisted hidden-member set, backed by
  // `workspaceState` so a hide survives webview reload AND window reload, and
  // is scoped per-workspace (a hide in project A doesn't bleed into project B).
  // Constructed once at activate; the watcher reads its live `keys()` snapshot
  // every tick, and the three webview handlers below are the ONLY mutators
  // (no auto-hide path — AC4).
  const hiddenMembersStore = new HiddenMembersStore(context.workspaceState);

  // E-07a (EPIC 86ca11187 §7.3): persisted REMOVED-member set, also backed by
  // `workspaceState`. More permanent than hide — a removed member is suppressed
  // from BOTH the default tree and the hidden-reveal set, and returns ONLY via
  // a yaml re-add (the store's `reconcile(roster)` runs on every roster reload
  // and clears the record on the absent→present transition). Mutated only by
  // the `ui:remove-member` handler + reconcile (no auto-remove path — AC4).
  const removedMembersStore = new RemovedMembersStore(context.workspaceState);

  // 86c9zn7vw: diagnostic Output channel. Constructed once at activate
  // time; survives `resolveWebviewView` remounts so the user's existing
  // scrollback isn't lost when the Activity Bar pane is closed + reopened.
  // The underlying `vscode.OutputChannel` is allocated lazily on the first
  // verbose emit — when the setting stays false from boot to deactivate,
  // no channel ever appears in the user's Output dropdown.
  const isVerboseSetting = (): boolean =>
    vscode.workspace
      .getConfiguration("claudeteam")
      .get<boolean>("diagnostic.verbose") ?? false;
  const diagnosticChannel: DiagnosticChannel = createDiagnosticChannel({
    isVerbose: isVerboseSetting,
    createOutputChannel: (name) => vscode.window.createOutputChannel(name),
  });

  // 86c9zn7tm: diagnostic panel manager — interactive companion to the
  // Output channel. The underlying `vscode.WebviewPanel` is allocated
  // lazily on the first `show()` (i.e. when the user invokes the
  // `claudeteam.openDiagnosticPanel` command). Manager construction is
  // cheap (an object + closure references); deferring the panel itself
  // means a session that never opens the panel pays zero cost.
  const diagnosticPanelManager: DiagnosticPanelManager =
    createDiagnosticPanelManager({
      diagnosticChannel,
      isVerbose: isVerboseSetting,
      extensionUri: context.extensionUri,
    });

  // Held out-of-band across resolveWebviewView invocations. Disposed-and-
  // replaced on every rebind so the subscription stack stays bounded
  // (M2-06 absorbed-NIT #1 — see AC7(e) verification).
  let watcherHandle: WatcherHandle | null = null;
  /**
   * Roster YAML watcher (M3-01). Disposed-and-replaced on every webview
   * resolve in lockstep with `watcherHandle`. The cleanup wrapper below
   * tears it down on `deactivate()`.
   */
  let rosterWatcherDisposable: vscode.Disposable | null = null;
  /**
   * Agents-folder drift watcher (TS-02). Disposed-and-replaced on every webview
   * resolve in lockstep with `watcherHandle`. Torn down on `deactivate()`.
   */
  let agentWatcherDisposable: vscode.Disposable | null = null;

  // TS-02 (team-setup epic, Decision 1): the `claudeteam.openRoster` command
  // and its auto-create-of-the-global-file flow are DROPPED. The roster is now
  // project-scoped at `<workspace>/.claude/claudeteam.yaml`, managed by the
  // webview's Manage Team panel (TS-03) via `ui:open-manage-team` + the
  // `setup:*` / `ui:*` message family. There is no global file to open and no
  // command to register.

  // Cleanup wrapper registered ONCE on activation. It tracks the *current*
  // watcher reference at the time `deactivate()` runs — not a snapshot from
  // the closure captured at resolve-time. Avoiding the per-resolve push is
  // the leak fix.
  context.subscriptions.push({
    dispose: () => {
      watcherHandle?.dispose();
      watcherHandle = null;
      rosterWatcherDisposable?.dispose();
      rosterWatcherDisposable = null;
      agentWatcherDisposable?.dispose();
      agentWatcherDisposable = null;
      // 86c9zn7vw: dispose the diagnostic channel (only releases the
      // underlying vscode.OutputChannel if one was actually allocated).
      diagnosticChannel.dispose();
      // 86c9zn7tm: dispose the diagnostic panel manager — releases the
      // underlying WebviewPanel + the tick subscription if the panel was
      // ever opened during the session.
      diagnosticPanelManager.dispose();
    },
  });

  provider.onResolved((webview) => {
    // M-fix (ticket 86c9yxv6d): capture the prior watcher's last-known state
    // BEFORE disposing it, so we can replay it to the freshly remounted
    // webview. VS Code calls `resolveWebviewView` every time the user
    // closes + reopens the Activity Bar pane (the webview is disposed in
    // between, losing its in-memory state). The new watcher starts with
    // `lastState = null` and its first async tick can take up to
    // `pollIntervalMs` (default 2000ms), during which the webview renders
    // the empty fixture state ("No live Claude Code sessions"). Posting
    // the prior state synchronously bridges that boot gap. The new
    // watcher's first tick still runs and overwrites with fresh state —
    // this is a fast-path, not a replacement. Source: Bram's triage
    // `team/bram-research/86c9yteju-triage-2026-05-26.md` § Observation 3.
    const priorState = watcherHandle?.getLastState() ?? null;

    // Dispose any prior watcher BEFORE rebinding — VS Code resolves the view
    // again after `Reload Window`, and a stale watcher would keep ticking
    // against a disposed webview (postMessage throws → caught in messageBus).
    watcherHandle?.dispose();
    rosterWatcherDisposable?.dispose();
    rosterWatcherDisposable = null;
    agentWatcherDisposable?.dispose();
    agentWatcherDisposable = null;

    const config = vscode.workspace.getConfiguration("claudeteam");
    const pollIntervalMs = config.get<number>("pollIntervalMs") ?? 2000;
    const rosterPathOverride = config.get<string>("rosterPath") ?? "";
    // M3-01 AC8: feature-flagged polling fallback for FS-watcher unreliability.
    // Default 0 = OFF; positive values enable a setInterval-driven mtime check.
    const rosterPollIntervalMs =
      config.get<number>("rosterPollIntervalMs") ?? 0;

    const claudeHome = join(homedir(), ".claude");

    // TS-02 (team-setup epic, Decision 1): the GLOBAL `~/.claudeteam/teams.yaml`
    // is DROPPED. The roster is project-scoped at
    // `<first-workspace-folder>/.claude/claudeteam.yaml`. The
    // `claudeteam.rosterPath` setting, when set, still wins as an explicit
    // override (absolute path to a roster file) — but the implicit default is
    // now the project file, NOT the global path. No code path resolves the
    // global location anymore (regression-guarded — TS-02 AC5).
    const projectRosterPath =
      rosterPathOverride.length > 0
        ? rosterPathOverride
        : resolveProjectRosterPath();

    watcherHandle = startWatcher({
      claudeHome,
      // globalRosterPath intentionally omitted (Decision 1 — global dropped).
      // The watcher's `globalRosterPath` is optional; absent → loadRoster treats
      // it as "no global roster", and only the project `claudeteam.yaml` feeds
      // the matcher.
      projectRosterPath,
      pollIntervalMs,
      // M3-03: read both inputs fresh every tick so config / workspace
      // changes apply on the NEXT tick without restarting the watcher
      // (AC5). Defaults: showAll=false (filter ON); workspaceFolders may
      // be undefined when no folder is open (don't-strand passthrough).
      getWorkspaceFolders: () =>
        vscode.workspace.workspaceFolders?.map((f) => ({
          fsPath: f.uri.fsPath,
        })),
      getShowAllSessionsGlobally: () =>
        vscode.workspace
          .getConfiguration("claudeteam")
          .get<boolean>("showAllSessionsGlobally") ?? false,
      // M3-10 AC5: read fresh every tick so toggling the setting applies
      // on the next tick without Reload Window. Default true (grouping ON).
      getCollapsePersonaTiles: () =>
        vscode.workspace
          .getConfiguration("claudeteam")
          .get<boolean>("collapsePersonaTiles") ?? true,
      // 86c9zmqa8: read-fresh-every-tick pattern for the uniform-cluster
      // auto-collapse toggle. Default true (polish ON) matches package.json.
      // Webview-only behavior; the host merely stamps it onto the wire.
      getAutoCollapseUniformClusters: () =>
        vscode.workspace
          .getConfiguration("claudeteam")
          .get<boolean>("autoCollapseUniformClusters") ?? true,
      // E-06a: read-fresh-every-tick snapshot of the persisted hidden-member
      // set. The store mutates only via the explicit hide/show/show-all
      // handlers below; this resolver never adds to it (AC4).
      getHiddenMemberKeys: () => hiddenMembersStore.keys(),
      // E-07a: read-fresh-every-tick snapshot of the persisted removed-member
      // set. Mutated only via the explicit remove handler + the yaml-gated
      // reconcile below; this resolver never adds to it (AC4).
      getRemovedMemberKeys: () => removedMembersStore.keys(),
      onStateChange: (state) => {
        void postState(webview, state);
      },
      // 86ca1tv41: post `roster:loaded` alongside `state:full` so the webview's
      // `manageConfig` is set → the Manage Team panel reaches its edit layout
      // (member list + character picker) instead of being stuck on the setup
      // wizard. Fired by the watcher on every emitting tick (same hash-skip as
      // onStateChange); a roster YAML edit re-fires it via the roster-in-hash.
      onRosterLoaded: (teams) => {
        void postRosterLoaded(webview, teams);
      },
      // 86c9zn7vw: feed the diagnostic dispatcher every tick. The
      // dispatcher's `recordTick` is a no-op fast path when
      // `claudeteam.diagnostic.verbose` is false; when true, emits the
      // per-tick summary line plus per-agent state-transition lines.
      onTickComplete: (info) => {
        diagnosticChannel.recordTick(info);
      },
      logger: {
        warn: (msg) => {
          console.warn(`[claudeteam.watcher] ${msg}`);
          // 86c9zn7vw: also surface watcher warnings to the diagnostic
          // channel when verbose is on — the user can correlate the
          // error timeline with tick history in one place.
          diagnosticChannel.recordError(msg);
        },
      },
    });

    // M-fix (ticket 86c9yxv6d) AC1: replay the prior watcher's last-known
    // state to the freshly remounted webview synchronously after the new
    // watcher is constructed, BEFORE its first async tick can fire. This
    // closes the 0–2s "No live Claude Code sessions" empty-state flash that
    // occurs on every pane close+reopen when sessions are active. Skip
    // entirely on first-resolve (priorState === null) — AC5: no regression
    // on first-open empty-state path; the new watcher's initial tick is the
    // sole source of state in that case.
    if (priorState !== null) {
      void postState(webview, priorState);
    }

    // M3-03 AC5: react to the showAllSessionsGlobally toggle (and any other
    // claudeteam.* setting change) without requiring Reload Window. The next
    // tick will read the fresh value via getShowAllSessionsGlobally and
    // re-filter; triggerTick() bypasses the regular interval to make the
    // effect feel instant.
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("claudeteam.showAllSessionsGlobally")) {
          watcherHandle?.triggerTick();
        }
        // M3-10 AC5: same instant-effect pattern for collapsePersonaTiles —
        // toggling the setting re-renders within one tick without Reload Window.
        if (e.affectsConfiguration("claudeteam.collapsePersonaTiles")) {
          watcherHandle?.triggerTick();
        }
        // 86c9zmqa8: instant-effect pattern for the uniform-cluster polish
        // toggle. Toggling it from Settings re-renders within one tick (the
        // hashState change ensures the webview is notified even if the
        // visible tile set is unchanged).
        if (e.affectsConfiguration("claudeteam.autoCollapseUniformClusters")) {
          watcherHandle?.triggerTick();
        }
      },
    );

    // Tie the configChangeDisposable lifetime to the watcherHandle: rebinding
    // the watcher on the next resolveWebviewView would otherwise leak this
    // listener. We attach it to the same dispose chain.
    const composedDispose = watcherHandle.dispose.bind(watcherHandle);
    watcherHandle.dispose = () => {
      configChangeDisposable.dispose();
      composedDispose();
    };

    // M3-01: live YAML hot-reload. On any change to the global or per-project
    // roster file, debounce 250ms, then trigger a watcher tick. The tick
    // re-runs loadRoster (already inside runTick) and reposts state to the
    // webview — so the user's YAML edit lands in the dashboard within
    // ~debounce + 1 tick (typically <500ms). The watcher itself never
    // throws — parse/validation failures surface through the matcher's
    // input as the previous valid roster (loadRoster already swallows
    // errors and reports them in `errors`); M3-04 renders the chip.
    rosterWatcherDisposable = startRosterWatcher({
      // TS-02 (Decision 1): global path dropped — only the project
      // `claudeteam.yaml` is watched for hot-reload.
      projectPath: projectRosterPath,
      pollIntervalMs: rosterPollIntervalMs,
      onRosterChange: (result) => {
        // E-07a (EPIC 86ca11187 §7.3): the yaml-gated reinstate path. On every
        // roster reload, reconcile the removed-member set against the freshly
        // loaded roster — ARM a removed key when its member leaves the roster
        // (sponsor deleted the block) and REINSTATE (clear the record) when an
        // armed member reappears (sponsor re-added the block). This is the ONLY
        // way a removed member comes back (no in-UI un-remove). reconcile()
        // mutates the in-memory store synchronously BEFORE the tick below reads
        // it via getRemovedMemberKeys, so a re-added member's tile reappears on
        // this same reload's tick.
        removedMembersStore.reconcile(result.roster);
        // The tick re-reads disk; we discard the RosterLoadResult here
        // and let runTick own the canonical reload. Keeps a single source
        // of truth for "what roster is in effect right now".
        watcherHandle?.triggerTick();
        // 86c9zn7vw: surface the reload to the diagnostic timeline. The
        // dispatcher's gate (claudeteam.diagnostic.verbose) makes this a
        // no-op when verbose is off.
        diagnosticChannel.recordRosterReload({
          teamsCount: result.roster.length,
          errorsCount: result.errors.length,
          warningsCount: result.warnings.length,
        });
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.rosterWatcher] ${msg}`),
        info: (msg) => console.info(`[claudeteam.rosterWatcher] ${msg}`),
      },
    });

    // TS-02 (team-setup epic): the setup controller owns detection compute,
    // the agents scan, the starter-config gen/read/write, character-source
    // resolution, and the `ui:*` setup handlers. Constructed per webview
    // resolve so its `post` sink targets THIS webview. The bundled sprites root
    // is `<extensionUri>/dist/webview/sprites` — the same tree the sprite
    // manifest copies (86ca191uy); resolveCharacterSources reads it for the
    // bundled half of the picker grid.
    const workspaceFolderPath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const bundledSpritesDir = vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "webview",
      "sprites",
    ).fsPath;
    const setupController = new SetupController({
      workspaceFolderPath,
      bundledSpritesDir,
      post: {
        detection: (state, scanned) =>
          void postSetupDetection(webview, state, scanned),
        characters: (sources) => void postSetupCharacters(webview, sources),
        configSaved: (ok, error) =>
          void postSetupConfigSaved(webview, ok, error),
      },
      dismissStore: {
        get: (key) => context.workspaceState.get<boolean>(key),
        update: (key, value) => context.workspaceState.update(key, value),
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.setup] ${msg}`),
        info: (msg) => console.info(`[claudeteam.setup] ${msg}`),
      },
    });
    // Emit initial detection + the character list to the freshly-resolved
    // webview so the dashboard root switches to the correct state immediately.
    // (The webview also pulls via ui:open-manage-team / ui:refresh; this push
    // is the fast-path. Per the fire-and-forget caveat, the webview's boot
    // ui:refresh handler below also re-emits — see onRefresh.)
    setupController.emitDetection();
    setupController.emitCharacters();

    // TS-02 (Decision 3 / spec §6): watch `.claude/agents/` for drift. New
    // agents → a non-blocking nudge (logged; the webview re-renders the
    // suggest count). Removed agents → flip the backing member to
    // `status: orphaned` via the controller's reconcile (NEVER auto-deletes;
    // NEVER auto-adds). The watcher only signals — the controller owns the
    // (conditional) config write + re-emits detection so the orphan treatment
    // renders.
    agentWatcherDisposable = startAgentWatcher({
      workspaceFolderPath,
      pollIntervalMs: rosterPollIntervalMs,
      onAgentsChange: (change) => {
        if (change.added.length > 0) {
          console.info(
            `[claudeteam.setup] ${change.added.length} new agent(s) found: ${change.added.join(", ")} — review in Manage Team (no auto-add).`,
          );
        }
        const present = new Set(change.scanned.map((a) => a.agentName));
        setupController.reconcileDrift(present);
        // A new agent can flip the trichotomy (empty→suggest) or change the
        // matched roster; trigger a tick so the dashboard tiles reconcile too.
        watcherHandle?.triggerTick();
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.agentWatcher] ${msg}`),
        info: (msg) => console.info(`[claudeteam.agentWatcher] ${msg}`),
      },
    });

    // Wire webview → host message dispatch. Handlers close over the current
    // watcherHandle / webview / setupController — replacing the handler
    // set on every resolve is intentional (the prior set referenced the
    // now-disposed watcher).
    const handlers: WebviewMessageHandlers = {
      onOpenTranscript: (msg) => {
        handleOpenTranscript(
          msg.payload.sessionId,
          msg.payload.agentId,
          claudeHome,
          () => watcherHandle?.getLastState() ?? null,
        );
      },
      onRefresh: () => {
        // 86c9z5hyp: use forceRefresh (not triggerTick) so the boot-time
        // `ui:refresh` from the webview's `boot()` (PR #73) actually
        // re-emits `state:full`. Without the hash bypass, tick-0 fires
        // before the webview's listener is wired, drops its `state:full`,
        // but primes `priorStateHash` — the subsequent ui:refresh-driven
        // tick produces the same hash and hash-skips, leaving the webview
        // stranded on empty-state. Bram's round-2 triage at
        // `team/bram-research/86c9yteju-triage-2026-05-26.md` § Round 2.
        watcherHandle?.forceRefresh();
        // TS-02: the webview's boot `ui:refresh` is also our reliable
        // (non-fire-and-forget) trigger to (re)emit the setup messages, since
        // the host's resolve-time push can race the webview's listener
        // registration (vscode-extension-conventions.md § fire-and-forget).
        setupController.emitDetection();
        setupController.emitCharacters();
      },
      // TS-02 (spec §1, §4): "Manage Team" / "Set up team" → the host re-emits
      // detection + characters so the webview can open the panel in the right
      // layout (wizard when no config, edit when configured). The webview
      // decides which layout from the `setup:detection` state; the host does
      // not own panel layout — it just supplies the data.
      onOpenManageTeam: () => {
        setupController.emitDetection();
        setupController.emitCharacters();
      },
      // TS-02 (spec §3.2): wizard confirm → generate + write starter config.
      onRunSetup: (msg) => {
        setupController.runSetup(msg.payload.include);
        // The new config changes the matched roster; force a tick so tiles
        // reconcile alongside the detection flip to `configured`.
        watcherHandle?.forceRefresh();
      },
      // TS-02 (spec §4.3): panel save → normalized structured write.
      onSaveTeam: (msg) => {
        setupController.saveTeam(msg.payload.config);
        watcherHandle?.forceRefresh();
      },
      // TS-02 (spec §5.2): assign/clear a member's character.
      onAssignCharacter: (msg) => {
        setupController.assignCharacter(
          msg.payload.memberId,
          msg.payload.character,
        );
        watcherHandle?.forceRefresh();
      },
      // TS-02 (spec §6.1): the ONLY member-delete path — confirmed orphan delete.
      onConfirmOrphanDelete: (msg) => {
        setupController.confirmOrphanDelete(msg.payload.memberId);
        watcherHandle?.forceRefresh();
      },
      // TS-02 (spec §7.2): remember-per-workspace dismiss of the suggest card.
      onDismissSetupSuggestion: () => {
        setupController.dismissSuggestion();
      },
      // E-06a (EPIC 86ca11187 §7.2): hide / show / show-all. Each mutates the
      // persisted store then forces a re-emit so the dashboard updates within
      // one tick. forceRefresh (not triggerTick) bypasses hash-skip — hiding a
      // member who had no live tile this session still changes the wire shape
      // (count + keys), but a defensive force avoids any edge where the hash
      // happens to match. The store's persistence promise is fire-and-forget;
      // the tick reads the in-memory Set synchronously (already updated), so
      // the UI never lags the (async) workspaceState write.
      onHideMember: (msg) => {
        void hiddenMembersStore.hide(msg.payload.teamId, msg.payload.memberId);
        watcherHandle?.forceRefresh();
      },
      onShowMember: (msg) => {
        void hiddenMembersStore.show(msg.payload.teamId, msg.payload.memberId);
        watcherHandle?.forceRefresh();
      },
      onShowAllHidden: () => {
        void hiddenMembersStore.showAll();
        watcherHandle?.forceRefresh();
      },
      // E-07a (EPIC 86ca11187 §7.3): remove a member. Adds the pair to the
      // persisted REMOVED set (un-armed — eligible for yaml-gated reinstate
      // only after the member later leaves the roster) then forces a re-emit so
      // the tile drops from BOTH the default tree and the hidden-reveal set
      // within one tick. No symmetric un-remove handler — restore is yaml-gated
      // via the reconcile path above. forceRefresh (not triggerTick) defeats
      // any edge where the visible tile set hash happens to match.
      onRemoveMember: (msg) => {
        void removedMembersStore.remove(msg.payload.teamId, msg.payload.memberId);
        watcherHandle?.forceRefresh();
      },
    };
    provider.setMessageHandlers(handlers);
  });

  // Register the WebviewViewProvider for the Activity Bar tile.
  // The view-id must match package.json contributes.views entry.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  // Register commands declared in package.json contributes.commands.
  // These are thin shims that delegate to the webview message handlers so
  // the command palette and webview UI funnel through the same code paths.
  //
  // TS-02 (Decision 1): `claudeteam.openRoster` is DROPPED — the global file
  // it auto-created no longer exists, and roster editing moves to the webview's
  // Manage Team panel (TS-03) via `ui:open-manage-team`.

  // `claudeteam.openSettings` (86ca16r2d) — gear icon in the Dashboard view
  // title bar (contributes.menus → view/title). Routes to the native Settings
  // UI filtered to ClaudeTeam's config via `@ext:claudeteam.claudeteam`. Like
  // openRoster, it needs no closure over `watcherHandle`, so it self-registers.
  registerOpenSettingsCommand(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeteam.refresh", () => {
      watcherHandle?.triggerTick();
    }),

    vscode.commands.registerCommand(
      "claudeteam.openAgentTranscript",
      // The command palette has no way to pre-select an agent; surface a
      // hint to use the dashboard tiles. Tile clicks go through the
      // `ui:open-transcript` webview message above.
      () => {
        void vscode.window.showInformationMessage(
          "ClaudeTeam: click an agent tile in the dashboard to open its transcript.",
        );
      },
    ),

    // 86c9zn7tm: open (or reveal) the diagnostic panel. Idempotent — the
    // manager itself handles "already open" via `panel.reveal()`. The
    // command palette entry doubles as the keybinding surface for users
    // who diagnose state issues often.
    vscode.commands.registerCommand("claudeteam.openDiagnosticPanel", () => {
      diagnosticPanelManager.show();
    }),
  );
}

/**
 * Called by VS Code on extension deactivation (window close, disable,
 * reload). Cleanup runs via `context.subscriptions` — the dispose wrapper
 * registered in `activate` tears down the live watcher.
 */
export function deactivate(): void {
  // No-op — cleanup via context.subscriptions on deactivate.
}

// =============================================================================
// Webview-message handlers (exported for unit test coverage)
// =============================================================================

/**
 * Resolve the project roster path from the first workspace folder, if any.
 *
 * TS-02 (team-setup epic, Decision 1): this now resolves the NEW project-scoped
 * `<first-folder>/.claude/claudeteam.yaml` (renamed from the pre-TS-02
 * `teams.yaml`). The global `~/.claudeteam/teams.yaml` is DROPPED — there is no
 * global fallback. Returns `undefined` when no folder is open (extension
 * running without a workspace — still valid; the dashboard shows the
 * detection-driven empty/suggest state and no rostered tiles).
 *
 * Multi-root = first folder only (ratify default — spec §7.4).
 *
 * Exported for tests.
 */
export function resolveProjectRosterPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return join(folder.uri.fsPath, ".claude", "claudeteam.yaml");
}

/**
 * Open the JSONL transcript for a given (sessionId, agentId). The path is
 * derived from the last-known state's `cwd` via the canonical `cwdToSlug`
 * rule (see `.claude/docs/data-sources.md` §2).
 *
 * Defensive behavior (per AC3):
 *   - Unknown sessionId → error message; do NOT throw.
 *   - File doesn't exist on disk → error message; do NOT throw.
 *   - showTextDocument failure → error message swallowed; do NOT throw.
 *
 * Exported for unit test coverage.
 */
export function handleOpenTranscript(
  sessionId: string,
  agentId: string,
  claudeHome: string,
  getLastState: () => { sessions: { sessionId: string; cwd: string }[] } | null,
): void {
  const state = getLastState();
  const session = state?.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: session ${sessionId} not found in current state.`,
    );
    return;
  }
  const slug = cwdToSlug(session.cwd);
  const jsonlPath = join(
    claudeHome,
    "projects",
    slug,
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`,
  );
  if (!existsSync(jsonlPath)) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: transcript not found: ${jsonlPath}`,
    );
    return;
  }
  // M4-03 AC6 / M4-01 §3.6: open as PREVIEW tab (italicized title, replaced
  // on next drill-in) — matches VS Code's native Explorer single-click
  // behavior. The drill-in interaction is exploratory; without preview mode,
  // browsing N agents accumulates N JSONL tabs the sponsor has to manually
  // close. Preview is promotable (double-click title or edit the file → it
  // becomes a regular tab) so zero capability is lost. Reversibility: one-
  // line revert if dogfooding finds the preview replacement annoying when
  // switching between two agents repeatedly.
  void vscode.window.showTextDocument(vscode.Uri.file(jsonlPath), {
    preview: true,
  });
}

// `handleOpenRoster` (M2-06) was removed in M3-02 in favor of the
// auto-creating `openRoster` flow in `./commands/openRoster.ts`. The
// auto-create behavior absorbs NIT #3 from M3-01's peer-review (the
// existsSync→createFileSystemWatcher race in registerDirWatcher). Both
// the command palette entry and the `ui:open-roster` webview message now
// route through the new flow.
