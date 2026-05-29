/**
 * render — top-level dashboard renderer.
 *
 * Owns the DOM mount: takes an AgentTree, builds the session blocks, replaces
 * the contents of `#root`. AC3 of M2-05.
 *
 * Re-render discipline (AC7):
 *   - `renderFull(state)`     — replace mount contents wholesale. Called on
 *                               `state:full` messages and on init.
 *   - `applyDelta(state, d)`  — at M2-05 this is a no-op fallback that triggers
 *                               a full re-render against an already-known state.
 *                               Live delta application is M4 optimization per
 *                               spec OQ §2 / backlog M2-05 AC7 footnote — the
 *                               webview doesn't invent a delta strategy ahead
 *                               of the host wiring delta emission.
 *
 * Empty-state rule (M2-05 + M3-04 AC4): if `state.sessions` is empty OR all
 * sessions are dead, the mount shows only `renderEmptyState()`. M3-04 splits
 * the empty branch by `state.filterApplied`:
 *   - filterApplied === true → the filtered-empty variant ("No Claude Code
 *     sessions for this workspace. Run `claude` in this folder, or enable
 *     `claudeteam.showAllSessionsGlobally`...").
 *   - otherwise              → the M2-05 generic variant ("No live Claude
 *     Code sessions.").
 *
 * Error chip layering (top → bottom of the mount):
 *   1. `rosterErrorChip`     — M3-04 data-driven roster errors (from
 *                              `state.rosterErrors`). Persists across ticks
 *                              until either the user dismisses (×) OR the
 *                              first error message changes.
 *   2. legacy `errorChip`    — M2-05 event-driven chip from
 *                              `roster:error` / file-watcher events.
 *                              Preserved for back-compat with M2-05's
 *                              dispatch pattern.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §3, §8
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC3, AC7
 *         team/nora-pl/milestone-3-backlog.md §M3-04 AC1-5
 */

import type {
  AgentTree,
  CharacterSource,
  ClaudeTeamConfig,
  ScannedAgent,
  SetupDetectionState,
  StateDelta,
  WebviewAgentTree,
} from "../shared/types.js";
import type { WebviewMessage } from "../shared/messages.js";
import { renderSessionBlock } from "./components/sessionBlock.js";
import { renderEmptyState, renderNoSetupState } from "./components/emptyState.js";
import { renderSuggestSetupCard } from "./components/suggestSetupCard.js";
import { renderManageTeamPanel } from "./components/manageTeamPanel.js";
import {
  renderErrorChip,
  type ErrorChipLevel,
} from "./components/errorChip.js";
import { renderRosterErrorChip } from "./components/rosterErrorChip.js";
import { renderHiddenMembersChip } from "./components/hiddenMembersChip.js";
import { isCollapsedPersonaGroup } from "./components/collapsedPersonaTile.js";
import { isMultiAgentPersonaTile } from "../shared/types.js";
import type { HiddenMemberKey, RemovedMemberKey } from "../shared/types.js";
import type { MemberDirectory } from "./memberDirectory.js";
import type { FinishedTracker } from "./finishedTracker.js";
import type { PrevStateTracker } from "./prevStateTracker.js";
import type {
  ExpandedGroupKey,
  ExpandedGroupsTracker,
} from "./expandedGroupsTracker.js";
import type {
  MenuOpenKey,
  MenuOpenTracker,
} from "./menuOpenTracker.js";
import type { SpriteTracker } from "./spriteTracker.js";

/** Persistent error state stored on the dashboard. */
export interface DashboardErrorState {
  level: ErrorChipLevel;
  title: string;
  detail: string;
  showOpenRosterButton: boolean;
}

export interface RenderContext {
  /** Mount node — typically document.getElementById("root"). */
  mount: HTMLElement;
  /** Webview → host postMessage dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Current error state, if any. Set externally before calling renderFull. */
  error?: DashboardErrorState | null;
  /**
   * M3-04 AC1: most-recently-dismissed roster-error first-message. When
   * non-null AND equal to `state.rosterErrors[0]`, the roster-error chip
   * is suppressed for this render. When the first error changes, the
   * cached key no longer matches and the chip re-appears.
   *
   * The caller (`main.ts`) owns this state and threads it through every
   * render; the chip's `onDismiss` callback writes back via
   * `onRosterErrorDismiss`.
   */
  rosterErrorDismissedKey?: string | null;
  /**
   * M3-04 AC1: callback invoked when the user clicks × on the roster-error
   * chip. The caller stores the passed key so the next render with the same
   * first-error short-circuits.
   */
  onRosterErrorDismiss?: (key: string) => void;
  /**
   * M3-04 NIT #3: webview-local first-seen tracker for finished-tile
   * freshness suffixes. Owned by the boot closure in `main.ts`; threaded
   * through every renderFull so it survives across re-renders. Optional —
   * when absent (e.g. component tests, fixture mode without state churn)
   * finished tiles render the bare `finished` string.
   *
   * Source: ClickUp 86c9ybtut
   */
  finishedTracker?: FinishedTracker;
  /**
   * Current wall-clock ms — defaults to `Date.now()` downstream. Test
   * injection point for deterministic freshness-suffix assertions.
   */
  nowMs?: number;
  /**
   * Webview-local last-rendered-state tracker (M4-05 §2.5). Threaded down
   * to every `renderAgentTile` so it can compare the new state against the
   * last-rendered state and apply `data-transition="to-<state>"` when they
   * differ. Owned by the boot closure in `main.ts`; survives across
   * re-renders so the transition flash only fires on actual host-side
   * state changes, not on every re-render of the same state.
   *
   * Optional — when omitted (e.g. component tests, fixture mode without
   * state churn) tiles render without transition tracking; this is the
   * back-compat path because `renderAgentTile`'s `prevState` prop is
   * optional and the renderer skips the `data-transition` attribute when
   * absent.
   *
   * Source: team/iris-ux/m4-polish-spec.md §2.5
   */
  prevStateTracker?: PrevStateTracker;
  /**
   * Webview-local expansion-state tracker (Obs 10, ClickUp 86c9zfmh1).
   * Threaded down to every `renderCollapsedPersonaTile` so user-expanded
   * persona wrappers survive the next host-driven re-render. Owned by the
   * boot closure in `main.ts`; the prune pass below evicts entries whose
   * wrappers no longer exist (e.g. a team disappears, a session goes dead).
   *
   * Optional — when omitted (component tests) wrappers always start
   * collapsed and clicks don't persist beyond the current DOM, matching
   * pre-Obs-10 behavior.
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
  /**
   * Webview-local overflow-menu open-state tracker (86ca1fjqu BUG 2). Threaded
   * down to every `renderAgentTile` / `renderMultiAgentPersonaTile` so an open
   * per-member "⋯" menu survives the next host-driven `renderFull` instead of
   * snapping shut every ~2s poll tick. Owned by the boot closure in `main.ts`;
   * the prune pass below evicts entries whose member/tile no longer exists.
   * Keyed by `sessionId:teamId:memberId` (the member identity, since the menu
   * acts on the whole tile). Optional — when omitted (component tests) menus
   * always start closed and clicks don't persist beyond the current DOM.
   *
   * Source: ClickUp 86ca1fjqu (overflow-menu auto-close on poll re-render)
   */
  menuOpenTracker?: MenuOpenTracker;
  /**
   * Host-injected webview-base URI for resolving sprite frame paths
   * (`<base>/sprites/<char>/...`). Set in VS Code mode from the `#root`
   * `data-sprite-base` attribute (host writes it via `asWebviewUri`).
   * Absent in browser-dev / component-test mode → tiles render text-only
   * (AC5, graceful degrade). Threaded down to each tile.
   *
   * Source: team/iris-ux/whole-team-display-spec.md §3
   */
  spriteBaseUri?: string;
  /**
   * Webview-local sprite playback tracker — idle-episode stickiness + frame-
   * timer disposal across the ~2s poll re-renders. Owned by the boot closure
   * in `main.ts`; pruned each render alongside the other trackers. Optional —
   * absent in component tests / fixture mode (tiles still render, no timers).
   */
  spriteTracker?: SpriteTracker;
  /**
   * E-06b — webview-local roster directory that resolves a hidden member's
   * display/role for the "show hidden agents" reveal list. Populated from
   * every rostered tile observed across ticks (see `memberDirectory.ts`).
   * Owned by the boot closure in `main.ts`. Optional — absent in component
   * tests / fixture mode, in which case revealed-hidden rows fall back to the
   * raw memberId.
   *
   * Source: team/iris-ux/whole-team-display-spec.md §7.2
   */
  memberDirectory?: MemberDirectory;
  /**
   * E-06b — current expansion state of the "N hidden agents" reveal panel.
   * Webview-local ephemeral UI state owned by the boot closure so the panel
   * doesn't snap shut every ~2s host-driven re-render. Defaults to collapsed.
   */
  hiddenMembersExpanded?: boolean;
  /**
   * E-06b — callback invoked when the user toggles the hidden-members reveal
   * panel. The caller flips its tracked `hiddenMembersExpanded` flag and
   * re-renders. Optional — absent in component tests (the chip toggles its
   * own DOM optimistically without persistence).
   */
  onToggleHiddenMembers?: (nextExpanded: boolean) => void;
  /**
   * Team-setup epic (TS-03 / spec §2). The host-computed detection trichotomy
   * + the scanned-agents list from the most recent `setup:detection` message.
   * When present, `renderFull` switches the WHOLE dashboard root on
   * `setup.state`:
   *   - `"empty"`         → centered "no orchestration setup" card (§2.3).
   *   - `"suggest-setup"` → dismissible "Orchestration detected" card (§2.2).
   *   - `"configured"`    → the normal dashboard (sessions/tiles) below.
   *
   * Optional + back-compat: when absent (pre-team-setup host, or before the
   * first `setup:detection` lands) `renderFull` falls through to the existing
   * session/empty rendering — exactly the pre-TS-03 behavior.
   */
  setup?: {
    state: SetupDetectionState;
    scanned: ScannedAgent[];
  };
  /**
   * Team-setup epic (spec §2.2). Whether the suggest-setup card was dismissed
   * for this workspace. The host owns the durable flag (workspaceState); the
   * webview mirrors it so a dismissed card doesn't re-appear within a session
   * before the host re-emits. When true AND `setup.state === "suggest-setup"`,
   * the card is suppressed and the dashboard shows live agents as today's
   * collapsed noise (§2.2). Optional → treated as false.
   */
  setupSuggestionDismissed?: boolean;
  /**
   * Team-setup epic (spec §4). When true, the Manage Team panel is open and
   * REPLACES the dashboard body (panel is a full-pane surface in V1 — Maya's
   * layout call). Driven by `ui:open-manage-team` (webview-local open flag).
   */
  managePanelOpen?: boolean;
  /**
   * Parsed `claudeteam.yaml` config for the Manage Team panel's edit layout
   * (spec §4). `null` → the panel serves the wizard layout (first run). Rides
   * the existing roster channel (per the TS-03 channel note — edit-layout
   * config travels on `state:full`/`roster:loaded`). Optional.
   */
  manageConfig?: ClaudeTeamConfig | null;
  /** Merged bundled + user character sources for the picker (spec §5). */
  characterSources?: CharacterSource[];
  /** Workspace folder name seed for the wizard/preview "Team: <name>" line. */
  teamNameSeed?: string;
  /** Called when the user closes the Manage Team panel (caller flips the flag). */
  onCloseManagePanel?: () => void;
}

/**
 * Full-replace render. Tears down current children, rebuilds from state.
 *
 * AC7 discipline note: a `state:full` message triggers this. A `state:delta`
 * is currently routed here via `applyDelta` because the host doesn't yet emit
 * deltas (M2 only emits state:full). When the host wires deltas in M4, this
 * function can be augmented with per-tile DOM patching; for now wholesale
 * replacement keeps the render layer simple and correct.
 */
/**
 * The renderer accepts either the pre-M3-10 narrow `AgentTree` shape (bare
 * `AgentTile[]` per team — produced by the host reducer before Felix's M3-10
 * widening lands) or the post-hydration `WebviewAgentTree` shape (per-entry
 * `RosterTileEntry[]` permitting `CollapsedPersonaGroup` wrappers). The
 * narrowing helper (`isCollapsedPersonaGroup`) routes per entry; both inputs
 * are valid at the type boundary because `AgentTile[]` is assignable to
 * `RosterTileEntry[]`.
 */
export type RenderableState = AgentTree | WebviewAgentTree;

/**
 * Read `claudeteam.autoCollapseUniformClusters` off the rendered state's
 * config block (86c9zmqa8). Webview-only behavior — the host stamps the
 * scalar onto the wire so the renderer doesn't roundtrip through Settings.
 *
 * Defensive cast through `Record<string, unknown>` so the renderer compiles
 * even when running against older fixtures whose typed shape may not include
 * the field. Default `true` matches the package.json schema default — polish
 * is ON by default; a tree without the field is treated as polish-on.
 */
function readAutoCollapseUniformClusters(state: RenderableState): boolean {
  const bag = state as unknown as {
    config?: { autoCollapseUniformClusters?: unknown };
  };
  if (typeof bag.config?.autoCollapseUniformClusters === "boolean") {
    return bag.config.autoCollapseUniformClusters;
  }
  return true;
}

/**
 * Read `claudeteam.collapsePersonaTiles` off the rendered state's config block
 * and translate it to the webview's `expandPersonaTiles` semantic (86ca1ej5c /
 * spec §6 Q4). Under option A a rostered N≥2 member ALWAYS renders as one
 * `MultiAgentPersonaTile`; the flag no longer toggles tile-vs-flat — it
 * repurposes to "expand the instance list by default":
 *
 *   collapsePersonaTiles === false → expandPersonaTiles === true (expanded)
 *   collapsePersonaTiles === true / absent → expandPersonaTiles === false (collapsed)
 *
 * Defensive cast through `Record<string, unknown>` so the renderer compiles
 * whether or not the host stamps the scalar onto the wire `config` block
 * (parallels `readAutoCollapseUniformClusters`). Default collapsed matches the
 * LOCKED resting view (spec §3.3 "Default state: collapsed") — the host's
 * package.json default is `collapsePersonaTiles: true`, so absence → collapsed
 * is the correct fallback.
 */
function readExpandPersonaTiles(state: RenderableState): boolean {
  const bag = state as unknown as {
    config?: { collapsePersonaTiles?: unknown };
  };
  if (typeof bag.config?.collapsePersonaTiles === "boolean") {
    return bag.config.collapsePersonaTiles === false;
  }
  return false;
}

/**
 * Extract the hidden-member reveal inputs (E-06b / EPIC 86ca11187 §7.2) from
 * the rendered state. `hiddenMemberKeys` is the persisted hidden set as
 * `` `${teamId}:${memberId}` `` strings (E-06a host vocab, PR #115) — the
 * chip's count is `.length`.
 *
 * Defensive cast through `Record<string, unknown>` so the renderer compiles
 * against either branch state-shape (pre-E-06a: field absent → empty array;
 * post-E-06a: present → consumed). Default `[]` per the wire contract
 * (`SerializedDashboardState.hiddenMemberKeys` — webview MUST treat undefined
 * as empty array). Filters to string entries defensively.
 */
function readHiddenMemberKeys(state: RenderableState): HiddenMemberKey[] {
  const bag = state as unknown as { hiddenMemberKeys?: unknown };
  if (!Array.isArray(bag.hiddenMemberKeys)) {
    return [];
  }
  return bag.hiddenMemberKeys.filter(
    (k): k is HiddenMemberKey => typeof k === "string" && k.includes(":"),
  );
}

/**
 * Extract the removed-member set (E-07b / EPIC 86ca11187 §7.3) from the
 * rendered state. `removedMemberKeys` is the persisted REMOVED set as
 * `` `${teamId}:${memberId}` `` strings (E-07a host vocab, PR #119) — mirror
 * of `readHiddenMemberKeys`, same defensive cast + string filter.
 *
 * Used to MASK removed members out of the "show hidden" reveal list: a removed
 * member must NOT appear anywhere on the dashboard, NOT even under show-hidden
 * (remove is more permanent than hide — restore is yaml-gated only, spec §7.3
 * / `RemovedMemberKey` docstring). The host already excludes removed members
 * from `hiddenMemberKeys`, but the webview applies the set-difference as
 * defense-in-depth so a removed-AND-hidden member can never leak into the
 * recovery surface regardless of host emit-order.
 */
function readRemovedMemberKeys(state: RenderableState): RemovedMemberKey[] {
  const bag = state as unknown as { removedMemberKeys?: unknown };
  if (!Array.isArray(bag.removedMemberKeys)) {
    return [];
  }
  return bag.removedMemberKeys.filter(
    (k): k is RemovedMemberKey => typeof k === "string" && k.includes(":"),
  );
}

export function renderFull(ctx: RenderContext, state: RenderableState): void {
  const {
    mount,
    postMessage,
    error,
    rosterErrorDismissedKey,
    onRosterErrorDismiss,
    finishedTracker,
    nowMs,
    prevStateTracker,
    expandedGroupsTracker,
    menuOpenTracker,
    spriteBaseUri,
    spriteTracker,
    memberDirectory,
    hiddenMembersExpanded,
    onToggleHiddenMembers,
    setup,
    setupSuggestionDismissed,
    managePanelOpen,
    manageConfig,
    characterSources,
    teamNameSeed,
    onCloseManagePanel,
  } = ctx;

  // ── Team-setup surface switch (spec §1, §2, §4) ─────────────────────────────
  // These are full-pane surfaces that REPLACE the dashboard body. Handle them
  // FIRST (before tracker work + the session/tile render) and return early.
  //
  // Precedence:
  //   1. Manage Team panel open → the panel (wizard or edit layout).
  //   2. detection === "empty"  → centered no-orchestration card.
  //   3. detection === "suggest-setup" (and not dismissed) → suggest card.
  //   4. otherwise → fall through to the normal dashboard (configured, OR a
  //      pre-team-setup host with no `setup` at all).

  // 1. Manage Team panel (explicit open — highest precedence).
  if (managePanelOpen === true) {
    mount.replaceChildren();
    mount.appendChild(
      renderManageTeamPanel({
        config: manageConfig ?? null,
        scanned: setup?.scanned ?? [],
        characters: characterSources ?? [],
        teamNameSeed: teamNameSeed ?? "",
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        postMessage,
        ...(onCloseManagePanel ? { onClose: onCloseManagePanel } : {}),
      }),
    );
    return;
  }

  // 2. + 3. Detection-state full-pane cards.
  if (setup !== undefined) {
    if (setup.state === "empty") {
      mount.replaceChildren();
      mount.appendChild(renderNoSetupState());
      return;
    }
    if (setup.state === "suggest-setup" && setupSuggestionDismissed !== true) {
      mount.replaceChildren();
      mount.appendChild(
        renderSuggestSetupCard({
          scannedCount: setup.scanned.length,
          postMessage,
        }),
      );
      return;
    }
    // suggest-setup + dismissed → fall through to the normal dashboard (live
    // agents render as collapsed background noise, today's behavior, §2.2).
    // configured → fall through to the normal dashboard.
  }

  // E-06b — observe every rostered tile this tick so the member directory
  // knows display/role for any member that later lands in hiddenMemberKeys.
  // Runs BEFORE the chip mount below (and before tiles get filtered out, but
  // here we observe the CURRENT tree — the directory is append-only across
  // ticks, so a member observed while visible survives once it's hidden).
  if (memberDirectory) {
    memberDirectory.observeState(state);
  }

  // Prune the finished-, prev-state-, and expanded-groups-trackers BEFORE
  // the render pass — any tile no longer present (or, for finishedTracker,
  // no longer in `finished` state) sheds its tracker entry. Without
  // pruning, a long-running dashboard slowly leaks entries for every agent
  // / group that ever existed. See finishedTracker.ts §lifecycle,
  // prevStateTracker.ts §lifecycle, expandedGroupsTracker.ts §lifecycle.
  //
  // M3-10: rosterTiles values are now `(AgentTile | CollapsedPersonaGroup)[]`.
  // We descend into CollapsedPersonaGroup.instances so tiles inside a
  // collapsed wrapper still keep their tracker entries (otherwise expanding
  // a wrapper would re-anchor every finished instance to "now", and prevState
  // would flash a spurious transition the first time the wrapper expands).
  //
  // Obs 10: the expanded-groups tracker is keyed at the WRAPPER level
  // (sessionId:teamId:personaName), so we register a key for each wrapper
  // we see — bare-tile entries do not contribute. The teamId is the
  // rosterTiles Map key.
  //
  // Single pass — all three trackers prune off the same walk to keep the
  // per-tick cost down.
  if (
    finishedTracker ||
    prevStateTracker ||
    expandedGroupsTracker ||
    menuOpenTracker ||
    spriteTracker
  ) {
    const currentFinishedKeys = new Set<`${string}:${string}`>();
    const currentAllKeys = new Set<`${string}:${string}`>();
    const currentGroupKeys = new Set<ExpandedGroupKey>();
    // Sprite tracker is keyed by sessionId:memberId (NOT agentId) — a
    // baseline `available` tile has agentId "" but a stable memberId.
    const currentSpriteKeys = new Set<`${string}:${string}`>();
    // Menu-open tracker is keyed by sessionId:teamId:memberId (the member
    // identity — the "⋯" menu acts on the whole tile). Only bare AgentTiles +
    // MultiAgentPersonaTiles carry the overflow menu; legacy
    // CollapsedPersonaGroup wrappers render a different component with no menu,
    // so they contribute no menu keys (86ca1fjqu).
    const currentMenuKeys = new Set<MenuOpenKey>();
    for (const session of state.sessions) {
      if (!session.isAlive) continue;
      for (const [teamId, entries] of session.rosterTiles.entries()) {
        for (const entry of entries) {
          // 86ca1dtr5 MultiAgentPersonaTile — walk instances for the
          // finished/prevState trackers (keyed per-instance agentId) and
          // register the wrapper's expansion key (keyed by memberId per spec
          // §3.3). The sprite tracker keys by the wrapper's own memberId (one
          // sprite per persona, regardless of N).
          if (isMultiAgentPersonaTile(entry)) {
            if (expandedGroupsTracker) {
              currentGroupKeys.add(
                expandedGroupsTracker.makeKey(
                  session.sessionId,
                  teamId,
                  entry.memberId,
                ),
              );
            }
            for (const inst of entry.instances) {
              const key: `${string}:${string}` = `${session.sessionId}:${inst.agentId}`;
              currentAllKeys.add(key);
              if (inst.state === "finished") {
                currentFinishedKeys.add(key);
              }
            }
            currentSpriteKeys.add(`${session.sessionId}:${entry.memberId}`);
            if (menuOpenTracker) {
              currentMenuKeys.add(
                menuOpenTracker.makeKey(
                  session.sessionId,
                  teamId,
                  entry.memberId,
                ),
              );
            }
            continue;
          }
          // Wrapper case — walk instances so tiles inside a collapsed
          // wrapper still keep their tracker entries, AND register the
          // wrapper's own key for the expansion tracker.
          if (isCollapsedPersonaGroup(entry)) {
            if (expandedGroupsTracker) {
              currentGroupKeys.add(
                expandedGroupsTracker.makeKey(
                  session.sessionId,
                  teamId,
                  entry.personaName,
                ),
              );
            }
            for (const inst of entry.instances) {
              const key: `${string}:${string}` = `${session.sessionId}:${inst.agentId}`;
              currentAllKeys.add(key);
              if (inst.state === "finished") {
                currentFinishedKeys.add(key);
              }
            }
            continue;
          }
          // Bare AgentTile case — unchanged from pre-M3-10.
          const key: `${string}:${string}` = `${session.sessionId}:${entry.agentId}`;
          currentAllKeys.add(key);
          if (entry.state === "finished") {
            currentFinishedKeys.add(key);
          }
          currentSpriteKeys.add(
            `${session.sessionId}:${entry.memberId}`,
          );
          if (menuOpenTracker) {
            currentMenuKeys.add(
              menuOpenTracker.makeKey(
                session.sessionId,
                teamId,
                entry.memberId,
              ),
            );
          }
        }
      }
    }
    if (finishedTracker) {
      finishedTracker.prune(currentFinishedKeys);
    }
    if (prevStateTracker) {
      prevStateTracker.prune(currentAllKeys);
    }
    if (expandedGroupsTracker) {
      expandedGroupsTracker.prune(currentGroupKeys);
    }
    if (menuOpenTracker) {
      menuOpenTracker.prune(currentMenuKeys);
    }
    if (spriteTracker) {
      spriteTracker.prune(currentSpriteKeys);
    }
  }

  // Wholesale replace — clears any prior render.
  mount.replaceChildren();

  // M3-04 AC1 — roster-error chip from state.rosterErrors. Rendered FIRST
  // (above any other chips) because a roster failure dominates everything
  // else the user is looking at. `renderRosterErrorChip` returns null when
  // there are no errors OR when the user has dismissed the current first-
  // error key — both paths leave the chip absent from the mount.
  const rosterErrors = state.rosterErrors ?? [];
  if (rosterErrors.length > 0) {
    const chip = renderRosterErrorChip({
      errors: rosterErrors,
      dismissedKey: rosterErrorDismissedKey ?? null,
      postMessage,
      ...(onRosterErrorDismiss ? { onDismiss: onRosterErrorDismiss } : {}),
    });
    if (chip) {
      mount.appendChild(chip);
    }
  }

  // Legacy event-driven error chip (M2-05). Kept for back-compat with the
  // `roster:error` / file-watcher event dispatch pattern. The two chips
  // can co-exist for one render cycle (file-watcher chip + roster-YAML
  // chip) — the user sees both surfaces stacked, which is correct.
  if (error) {
    mount.appendChild(
      renderErrorChip({
        level: error.level,
        title: error.title,
        detail: error.detail,
        ...(error.showOpenRosterButton ? { showOpenRosterButton: true } : {}),
        postMessage,
      }),
    );
  }

  // E-06b — "N hidden agents [show]" recovery chip (spec §7.2). Mounted
  // alongside the state-filter chips so the reveal/unhide surface is
  // discoverable wherever the filters are. Renders nothing (null) when the
  // hidden set is empty — the chip only matters once the sponsor has hidden
  // at least one member. Unlike the idle/finished filters (state-driven), this
  // set is driven by explicit, persisted user hide actions (E-06a host).
  //
  // E-07b — MASK removed members out of the reveal list (spec §7.3). A removed
  // member must never appear anywhere, NOT even under "show hidden" (remove is
  // more permanent than hide). The host already excludes removed members from
  // `hiddenMemberKeys`, but we apply the set-difference here as defense-in-
  // depth so a removed-AND-hidden member can't leak into the recovery surface.
  const removedKeySet = new Set<string>(readRemovedMemberKeys(state));
  const hiddenMemberKeys = readHiddenMemberKeys(state).filter(
    (k) => !removedKeySet.has(k),
  );
  const hiddenMembersChip = renderHiddenMembersChip({
    hiddenMemberKeys,
    expanded: hiddenMembersExpanded ?? false,
    postMessage,
    ...(memberDirectory
      ? {
          resolveMember: (teamId: string, memberId: string) =>
            memberDirectory.resolve(teamId, memberId),
        }
      : {}),
    ...(onToggleHiddenMembers
      ? { onToggle: onToggleHiddenMembers }
      : {}),
  });
  if (hiddenMembersChip) {
    mount.appendChild(hiddenMembersChip);
  }

  const hasLiveSession = state.sessions.some((s) => s.isAlive);
  if (state.sessions.length === 0 || !hasLiveSession) {
    // Empty state — but still render dead-session headers if any exist so the
    // sponsor can see them. Spec §3.2 + §4 dead-session treatment.
    if (state.sessions.length === 0) {
      // M3-04 AC4: filter-aware empty variant. Only the truly-empty branch
      // gets the variant flag — if dead sessions are present the user has
      // enough signal already; we don't double up.
      mount.appendChild(
        renderEmptyState({ filtered: state.filterApplied === true }),
      );
      return;
    }
    // All-dead case — still render the dead session blocks (header only).
    // Dead sessions render no tiles per sessionBlock.ts §dead treatment, so
    // the tracker is not threaded into this branch — there are no tiles to
    // observe.
    for (const session of state.sessions) {
      mount.appendChild(renderSessionBlock({ session, postMessage }));
    }
    // Also show the empty-state line so the user understands "nothing live."
    mount.appendChild(renderEmptyState());
    return;
  }

  // 86c9zmqa8: read the auto-collapse-uniform-clusters scalar from state
  // once and thread it down to every session block / team card / wrapper.
  // The flag is webview-only — its host-side journey ends in `state.config`.
  const autoCollapseUniformClusters = readAutoCollapseUniformClusters(state);

  // 86ca1ej5c — read the repurposed collapsePersonaTiles flag once and thread
  // it down as `expandPersonaTiles` so multi-agent persona tiles render their
  // instance list expanded-by-default when the sponsor opts in (spec §6 Q4).
  const expandPersonaTiles = readExpandPersonaTiles(state);

  for (const session of state.sessions) {
    mount.appendChild(
      renderSessionBlock({
        session,
        postMessage,
        autoCollapseUniformClusters,
        expandPersonaTiles,
        ...(finishedTracker ? { finishedTracker } : {}),
        ...(prevStateTracker ? { prevStateTracker } : {}),
        ...(expandedGroupsTracker ? { expandedGroupsTracker } : {}),
        ...(menuOpenTracker ? { menuOpenTracker } : {}),
        ...(nowMs !== undefined ? { nowMs } : {}),
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        ...(spriteTracker ? { spriteTracker } : {}),
      }),
    );
  }
}

/**
 * Apply a state delta to the current render.
 *
 * M2-05 scope (per spec OQ §2): the host does NOT emit deltas yet, so this
 * function exists for type-completeness and to log incoming deltas without
 * mis-applying them. When the host wires delta emission in M4, this function
 * will be replaced with per-tile DOM patching; until then, callers should
 * follow a delta with the next `state:full` to refresh.
 */
export function applyDelta(_state: AgentTree, _delta: StateDelta): void {
  // Intentional no-op. M4 work — see render.ts module docstring.
}
