/**
 * Host ↔ Webview message protocol.
 *
 * Single source of truth — both `src/extension/**` (extension host) and
 * `src/webview/**` (webview) import from here. Keep free of runtime
 * dependencies on either side.
 *
 * Every message is a discriminated union object with a `type` field.
 * Add new message types rather than overloading existing ones.
 *
 * JSON constraint: all payload values must be JSON-serializable. No `undefined`
 * values, no class instances, no circular refs, no functions. VS Code serializes
 * postMessage payloads via JSON.stringify internally.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Message protocol"
 */

import type {
  AgentState,
  CharacterSource,
  ClaudeTeamConfig,
  HiddenMemberKey,
  MemberCharacter,
  RemovedMemberKey,
  RosterTileEntry,
  ScannedAgent,
  SessionTree,
  SetupDetectionState,
  StateDelta,
  Team,
} from "./types.js";

// =============================================================================
// Host → Webview
// =============================================================================

/**
 * JSON-safe variant of `SessionTree` — `rosterTiles` is flattened from
 * `Map<string, RosterTileEntry[]>` to a plain object keyed by teamId. Maps do
 * not round-trip through `JSON.stringify` (they serialize to `{}`), and VS
 * Code's `webview.postMessage` uses JSON internally. See
 * `.claude/docs/vscode-extension-conventions.md` "JSON-serialization constraint".
 *
 * Each value is `RosterTileEntry[]` — entries are either bare `AgentTile`
 * objects (N=1 back-compat) or `CollapsedPersonaGroup` wrappers (M3-10 N>1).
 * Both are plain JSON-safe objects; no further flattening needed.
 */
export interface SerializedSessionTree
  extends Omit<SessionTree, "rosterTiles"> {
  rosterTiles: Record<string, RosterTileEntry[]>;
}

/**
 * JSON-safe variant of `DashboardState` — `sessions[].rosterTiles` flattened
 * from Maps to plain objects. Mirror image of the on-wire shape produced by
 * `serializeState` in `src/extension/messageBus.ts`.
 *
 * Why a distinct type (M2-06 absorbed-NIT #2): previously `postState` cast its
 * payload via `as unknown as DashboardState` because the wire shape differed
 * from the in-memory shape. Introducing `SerializedDashboardState` removes the
 * cast — the message type now matches the actual JSON payload.
 *
 * `filterApplied` (M3-03): mirrors `AgentTree.filterApplied` — boolean (no
 * Map/Set/Date — JSON-safe as-is per the wire-shape constraint documented in
 * `.claude/docs/vscode-extension-conventions.md` "JSON-serialization
 * constraint"). Defaults to false on the wire when omitted by the host.
 *
 * `rosterErrors` / `rosterWarnings` (M3-04): mirror `AgentTree.rosterErrors`
 * / `.rosterWarnings`. Plain `string[]` — JSON-safe; no flatten step
 * needed. Webview MUST treat `undefined` as empty array. Verbatim loader
 * strings — the webview renders them as-is in the chip / details panel.
 */
export interface SerializedDashboardState {
  sessions: SerializedSessionTree[];
  /**
   * Window-scoped filter applied this tick (see AgentTree.filterApplied).
   * Optional for back-compat — webview MUST treat `undefined` as `false`.
   */
  filterApplied?: boolean;
  /**
   * Roster load errors from the most recent tick (M3-04). Optional for
   * back-compat — webview MUST treat `undefined` as empty array.
   */
  rosterErrors?: string[];
  /**
   * Roster load warnings from the most recent tick (M3-04). Optional for
   * back-compat — webview MUST treat `undefined` as empty array.
   */
  rosterWarnings?: string[];
  /**
   * Count of rostered agent tiles suppressed this tick because their
   * `(teamId, memberId)` is in the user's persisted hidden-member set
   * (E-06a / EPIC 86ca11187 §7.2). Used by the webview header chip to render
   * "N hidden — show". Optional + defaults to 0 — webview MUST treat
   * `undefined` as 0. Mirror of `AgentTree.hiddenMemberCount`.
   */
  hiddenMemberCount?: number;
  /**
   * The persisted hidden-member set in effect this tick, as `HiddenMemberKey`
   * strings (`` `${teamId}:${memberId}` ``). E-06b renders the "show hidden"
   * recovery surface + unhide affordances from this list. Plain `string[]` —
   * JSON-safe (a `Set` would serialize to `{}`). Optional + defaults to empty
   * array — webview MUST treat `undefined` as `[]`. Mirror of
   * `AgentTree.hiddenMemberKeys`.
   */
  hiddenMemberKeys?: HiddenMemberKey[];
  /**
   * Count of rostered agent tiles suppressed this tick because their
   * `(teamId, memberId)` is in the user's persisted REMOVED-member set
   * (E-07a / EPIC 86ca11187 §7.3). Diagnostic tick-local count (parallel to
   * `hiddenMemberCount`). Optional + defaults to 0 — webview MUST treat
   * `undefined` as 0. Mirror of `AgentTree.removedMemberCount`.
   */
  removedMemberCount?: number;
  /**
   * The persisted removed-member set in effect this tick, as `RemovedMemberKey`
   * strings (`` `${teamId}:${memberId}` ``). E-07b consumes this so it never
   * offers an unhide/show affordance for a removed member (remove is more
   * permanent than hide — restore is yaml-gated only). Plain `string[]` —
   * JSON-safe (a `Set` would serialize to `{}`). Optional + defaults to empty
   * array — webview MUST treat `undefined` as `[]`. Mirror of
   * `AgentTree.removedMemberKeys`.
   */
  removedMemberKeys?: RemovedMemberKey[];
  /**
   * Mirror of `claudeteam.*` config scalars relevant to the webview's
   * rendering (M5). Lets the chip boot with its toggle reflecting the truth
   * stored in VS Code Settings (no roundtrip required for initial render).
   *
   * Optional — back-compat with pre-M5 consumers. Webview MUST treat the
   * entire `config` block AND individual fields as possibly undefined and
   * default to `false`. See `m5-hide-finished-spec.md` §3.5 Field B + §7.1.
   *
   * Future filter / display toggles add NEW keys under this block rather than
   * polluting the top-level wire shape (per spec §3.5 rationale).
   */
  config?: {
    /**
     * Mirror of `claudeteam.autoCollapseUniformClusters` (uniform-cluster
     * polish ticket 86c9zmqa8). See `AgentTree.config.autoCollapseUniformClusters`
     * for semantics. Optional for back-compat — webview MUST treat
     * `undefined` as `false`.
     */
    autoCollapseUniformClusters?: boolean;
  };
}

/**
 * Full state snapshot sent on every poll tick (and on initial view load).
 *
 * **Wire shape:** `SerializedDashboardState` (Maps flattened to plain objects).
 * The webview reads `payload.sessions[].rosterTiles` as `Record<string, AgentTile[]>`
 * via `Object.entries`, NOT `Map.entries`. The in-memory `DashboardState` /
 * `AgentTree` shape with `Map` lives only inside the extension host; the boundary
 * conversion happens in `serializeState`.
 */
export type StateFullMessage = {
  type: "state:full";
  payload: SerializedDashboardState;
};

/**
 * Partial state delta. Shape coordinated with Felix's M2-04 watcher plan and
 * canonicalized in `types.ts` as `StateDelta`:
 *   - `added`   — tiles newly observed since the last `state:full` baseline.
 *   - `updated` — tiles whose state / activity / model changed.
 *   - `removed` — `TileKey`s (`sessionId:agentId`) whose tile should be dropped
 *                 (session ended, agent disappeared).
 *
 * At M2-05 the host only sends `state:full`; the webview MAY no-op on incoming
 * `state:delta` messages or fall back to a request-state-full pattern. Wiring
 * delta application is M4 optimization. Defined here so the type is available
 * across both processes from day one.
 */
export type StateDeltaMessage = {
  type: "state:delta";
  payload: StateDelta;
};

/** Roster loaded successfully. */
export type RosterLoadedMessage = {
  type: "roster:loaded";
  payload: { teams: Team[] };
};

/** Roster failed to load (YAML parse error, missing file, etc.). */
export type RosterErrorMessage = {
  type: "roster:error";
  payload: { error: string };
};

/**
 * One state transition observed during a tick (86c9zn7tm). Mirror of the
 * extension-host `TickTransition` shape — JSON-safe scalars only. The panel
 * webview renders the short-id pair + the prev→next arrow.
 */
export interface DiagnosticTickTransition {
  sessionShortId: string;
  agentShortId: string;
  /** Full id retained on the wire for future drill-in support. */
  sessionId: string;
  /** Full id retained on the wire for future drill-in support. */
  agentId: string;
  prev: AgentState;
  next: AgentState;
}

/**
 * One ring-buffer entry posted to the diagnostic panel (86c9zn7tm). Mirror
 * of the extension-host `TickHistoryEntry` shape — JSON-safe primitives only.
 *
 * `timestampMs` is the host's `Date.now()` at record time; the panel renders
 * it via `new Date(timestampMs).toISOString()` so the format stays uniform
 * with the Output channel's `[<ISO>]` prefix.
 */
export interface DiagnosticTickHistoryEntry {
  tickNumber: number;
  timestampMs: number;
  durationMs: number;
  emitted: boolean;
  transitions: DiagnosticTickTransition[];
}

/**
 * Diagnostic panel state snapshot (86c9zn7tm). Posted on every tick (when
 * the panel is open and not paused) and on `ui:diagnostic-refresh`.
 *
 * `state` is null only before the first tick lands — opening the panel
 * BEFORE any state has been recorded shows an empty body with the "no
 * ticks yet" empty-state message.
 *
 * Reuses the dashboard's `SerializedDashboardState` so the panel can render
 * the current per-session per-agent breakdown without owning a second
 * serialization path. Maya's pre-existing `hydrateState` is NOT reused — the
 * panel does its own pure-projection rendering against the wire shape
 * directly (avoids a Map allocation per push for data the panel only reads).
 */
export type DiagnosticStateMessage = {
  type: "diagnostic:state";
  payload: {
    ticks: DiagnosticTickHistoryEntry[];
    state: SerializedDashboardState | null;
    /**
     * Whether the diagnostic Output channel's verbose setting is currently
     * on. Shown as a chip in the panel header so the user knows whether
     * the Output channel scrollback is being populated alongside.
     */
    verbose: boolean;
  };
};

// =============================================================================
// Team-setup epic — host → webview (TS-02, LOCKED Vocabulary contract).
// See team/nora-pl/team-setup-epic-backlog.md § "Message types" +
// team/iris-ux/team-setup-spec.md. New types ADDED (never overload — messages.ts
// rule); all payloads JSON-safe (no Map/Set/Date — validated M2-04).
// =============================================================================

/**
 * Host-computed detection trichotomy + the scanned-agents list (Decision 2 /
 * spec §2, §3.1). The webview switches the entire dashboard root on `state`
 * and, in the `suggest-setup` card + the wizard's scan step, renders one row
 * per `scanned` entry.
 *
 * `scanned` is ALWAYS the full agents-folder scan result (even in `configured`
 * state — the Manage Team panel + drift nudge consume it). `scanned.length`
 * drives the suggest-setup card's count line (never a hardcoded number).
 */
export type SetupDetectionMessage = {
  type: "setup:detection";
  payload: { state: SetupDetectionState; scanned: ScannedAgent[] };
};

/**
 * The merged bundled + user-folder character list for the picker grid
 * (Decision 7 / spec §5). Produced by the host's `resolveCharacterSources()`
 * (Pt-2). `sources` may be empty (no bundled chars — should not happen
 * post-build, but the webview defends per spec §5.2 empty-grid edge case).
 */
export type SetupCharactersMessage = {
  type: "setup:characters";
  payload: { sources: CharacterSource[] };
};

/**
 * Ack for a config-mutating action — the `ui:run-setup` (wizard create) and
 * `ui:save-team` (panel save) paths both resolve to this (spec §3.3, §4.3).
 *
 *   ok: true            → write succeeded; the webview transitions
 *                         (wizard → edit layout / shows "Saved"). The host
 *                         also emits a fresh `setup:detection` reflecting the
 *                         now-`configured` state.
 *   ok: false, error    → write failed; the webview surfaces "Couldn't save:
 *                         <error>" inline and keeps the user's edits.
 *
 * `error` is a human-readable string (omitted on success). JSON-safe.
 */
export type SetupConfigSavedMessage = {
  type: "setup:config-saved";
  payload: { ok: boolean; error?: string };
};

/**
 * Host asks the webview to OPEN the Manage Team panel (86ca1u0nf).
 *
 * The Manage Team panel's open/closed state is webview-LOCAL (the
 * `managePanelOpen` flag in `src/webview/main.ts`) — historically the only way
 * to set it was the webview's own outbound `ui:open-manage-team` interception
 * (the suggest-setup card's "Set up team" CTA). That left the panel UNREACHABLE
 * once a config existed (the suggest card no longer renders), so there was no
 * discoverable entry point.
 *
 * This message is the host→webview counterpart: the new `claudeteam.manageTeam`
 * command (dashboard title-bar button + Command Palette) posts it so the panel
 * opens on demand. The webview sets `managePanelOpen = true` + re-renders; the
 * WIZARD-vs-EDIT layout is decided exactly as before — by the `setup:detection`
 * state + `manageConfig` (from `roster:loaded`), so no config → wizard, config
 * present → edit layout (the #141 surface). No payload.
 */
export type OpenManageTeamPanelMessage = {
  type: "setup:open-manage-team";
};

/** Union of all host → webview messages. */
export type HostMessage =
  | StateFullMessage
  | StateDeltaMessage
  | RosterLoadedMessage
  | RosterErrorMessage
  | DiagnosticStateMessage
  | SetupDetectionMessage
  | SetupCharactersMessage
  | SetupConfigSavedMessage
  | OpenManageTeamPanelMessage;

// =============================================================================
// Webview → Host
// =============================================================================

/** User clicked on a rostered agent tile — open its JSONL in the editor. */
export type OpenTranscriptMessage = {
  type: "ui:open-transcript";
  payload: { sessionId: string; agentId: string };
};

/** User triggered the "Open Roster" action. */
export type OpenRosterMessage = {
  type: "ui:open-roster";
};

/** User triggered manual refresh. */
export type RefreshMessage = {
  type: "ui:refresh";
};

/**
 * User hid a rostered member from the default view (E-06a / EPIC 86ca11187
 * §7.2 — reversible hide-agent). The host adds `(teamId, memberId)` to its
 * persisted hidden-member set (`workspaceState`) and re-emits state on the
 * next tick with the member's tile suppressed from the default tree + the
 * "N hidden" count bumped.
 *
 * Distinct message type per the messages.ts "add a new type, don't overload"
 * rule: the hidden set is a dynamic collection, and the action verb (add-one)
 * is semantically distinct from the show/show-all verbs below.
 *
 * Payload carries the `(teamId, memberId)` PAIR — not the pre-joined
 * `HiddenMemberKey` string — so the webview never has to know the key-join
 * convention; the host builds the key via `hiddenMemberKey()`. JSON-safe
 * scalars only.
 */
export type HideMemberMessage = {
  type: "ui:hide-member";
  payload: { teamId: string; memberId: string };
};

/**
 * User un-hid a single rostered member (E-06a / EPIC 86ca11187 §7.2). The
 * host removes `(teamId, memberId)` from its persisted hidden-member set and
 * re-emits state — the member's tile returns to the default view on the next
 * tick. Reversible counterpart to `ui:hide-member`; no YAML edit (that's the
 * separate remove-agent flow, E-07).
 */
export type ShowMemberMessage = {
  type: "ui:show-member";
  payload: { teamId: string; memberId: string };
};

/**
 * User clicked "show all" on the hidden-members recovery chip (E-06a / EPIC
 * 86ca11187 §7.2). The host CLEARS its entire persisted hidden-member set and
 * re-emits state — every previously-hidden member returns to the default view.
 * No payload (the action targets the whole set).
 */
export type ShowAllHiddenMessage = {
  type: "ui:show-all-hidden";
};

/**
 * User removed a rostered member from the dashboard (E-07a / EPIC 86ca11187
 * §7.3 — yaml-gated remove-agent). The host adds `(teamId, memberId)` to its
 * persisted REMOVED-member set (`workspaceState`) and re-emits state on the
 * next tick with the member's tile suppressed from BOTH the default tree AND
 * the hidden-reveal set (more permanent than hide).
 *
 * ## Why there is NO `ui:un-remove-member` counterpart
 *
 * Remove is yaml-gated by design (DECISIONS §30 / spec §7.3): a removed member
 * returns ONLY by re-adding its block to `teams.yaml`. The host's
 * `RemovedMembersStore.reconcile()` runs on every roster reload and clears the
 * removal record when the member reappears in the roster (absent→present
 * transition). There is intentionally no in-UI un-remove action, so this union
 * carries no symmetric un-remove message — unlike hide's
 * `ui:show-member` / `ui:show-all-hidden` pair.
 *
 * Distinct message type (NOT a `ui:hide-member` overload) per the messages.ts
 * "add a new type, don't overload" rule: remove has different persistence
 * semantics (no in-UI reversal) and a different filter (suppresses past the
 * show-hidden surface). Payload carries the `(teamId, memberId)` PAIR — the
 * host builds the key via `removedMemberKey()`. JSON-safe scalars only.
 */
export type RemoveMemberMessage = {
  type: "ui:remove-member";
  payload: { teamId: string; memberId: string };
};

/**
 * Diagnostic panel asked the host to clear the in-memory tick ring buffer
 * (86c9zn7tm). Triggered by the panel's "Clear" button. Does NOT clear the
 * Output channel scrollback (that's a VS Code action on the channel
 * dropdown). After clearing, the next tick will repopulate the buffer.
 */
export type DiagnosticClearMessage = {
  type: "ui:diagnostic-clear";
};

/**
 * Diagnostic panel asked the host to pause / resume auto-refresh pushes
 * (86c9zn7tm). When paused, the host continues to update the ring buffer
 * (ticks keep flowing) but suppresses `diagnostic:state` pushes to the
 * panel — useful for inspecting a frozen moment without it scrolling out.
 * Sending `paused: false` resumes pushes AND immediately sends a fresh
 * snapshot so the panel catches up.
 */
export type DiagnosticPauseMessage = {
  type: "ui:diagnostic-pause";
  payload: { paused: boolean };
};

/**
 * Diagnostic panel asked the host for a fresh snapshot (86c9zn7tm). Used
 * by the panel's "Refresh" button and by the panel's boot handshake (the
 * webview-initiated pull pattern — see `vscode-extension-conventions.md`
 * §"`webview.postMessage` is fire-and-forget — NOT buffered"). The host
 * responds with a `diagnostic:state` carrying the current snapshot.
 */
export type DiagnosticRefreshMessage = {
  type: "ui:diagnostic-refresh";
};

// =============================================================================
// Team-setup epic — webview → host (TS-02, LOCKED Vocabulary contract).
// New types ADDED (never overload). All payloads JSON-safe.
// =============================================================================

/**
 * User opened the Manage Team panel (spec §1, §4). The host decides which
 * layout to serve based on whether `claudeteam.yaml` exists: wizard layout
 * (no config) vs edit layout (config present). No payload — the host already
 * knows the project + config state.
 *
 * Entry points: the suggest-setup card's "Set up team" CTA and the persistent
 * title-bar "Manage Team" action (spec §1 navigation).
 */
export type OpenManageTeamMessage = {
  type: "ui:open-manage-team";
};

/**
 * User confirmed the setup wizard (spec §3.2 "Confirm & create"). `include`
 * is the list of `ScannedAgent.agentName`s the user kept checked. The host
 * generates a starter {@link ClaudeTeamConfig} from those agents (seeded
 * match-keys, blank roles, null characters, `status: live`), writes
 * `claudeteam.yaml`, and acks via `setup:config-saved` + a fresh
 * `setup:detection`. JSON-safe `string[]`.
 */
export type RunSetupMessage = {
  type: "ui:run-setup";
  payload: { include: string[] };
};

/**
 * User saved edits in the Manage Team panel (spec §4.3). The webview sends the
 * FULL edited {@link ClaudeTeamConfig}; the host performs a structured,
 * normalized write (NOT comment-preserving — Decision 5, panel owns the
 * format) and acks via `setup:config-saved`. The `config` payload is JSON-safe
 * (plain objects / arrays / scalars — `Member.character` is `string | null`).
 */
export type SaveTeamMessage = {
  type: "ui:save-team";
  payload: { config: ClaudeTeamConfig };
};

/**
 * User assigned or cleared a member's character via the picker (spec §5.2).
 * `character` is a {@link CharacterSource} id, or `null` to clear (revert to
 * text tile). The host updates the member's `character` field + re-writes +
 * acks via `setup:config-saved`. Payload carries the `memberId` + the chosen
 * character id (or null). JSON-safe scalars.
 *
 * NOTE: scoped by `memberId` alone (not the `(teamId, memberId)` pair used by
 * hide/remove) because the team-setup epic's `claudeteam.yaml` is single-team
 * per project in V1; the host resolves the member within the sole team. If
 * multi-team configs land later, this gains a `teamId` field (additive).
 */
export type AssignCharacterMessage = {
  type: "ui:assign-character";
  payload: { memberId: string; character: MemberCharacter };
};

/**
 * User confirmed deletion of an ORPHANED member (spec §6.1). The host removes
 * the member from `claudeteam.yaml`, re-writes, and acks via
 * `setup:config-saved`; the orphaned tile disappears on the next
 * `setup:detection` / state update. This is the ONLY delete path for a member
 * (orphaned members are kept greyed until this explicit confirm — Decision 3).
 * JSON-safe scalar payload.
 */
export type ConfirmOrphanDeleteMessage = {
  type: "ui:confirm-orphan-delete";
  payload: { memberId: string };
};

/**
 * User dismissed the suggest-setup card (spec §2.2 ✕ / "Not now"). The host
 * persists a remember-per-workspace dismiss flag (workspaceState — ratify
 * proposal §7.2 Option A) so the card stays dismissed for that workspace until
 * a config is created or the agent count materially changes. No payload.
 */
export type DismissSetupSuggestionMessage = {
  type: "ui:dismiss-setup-suggestion";
};

/** Union of all webview → host messages. */
export type WebviewMessage =
  | OpenTranscriptMessage
  | OpenRosterMessage
  | RefreshMessage
  | HideMemberMessage
  | ShowMemberMessage
  | ShowAllHiddenMessage
  | RemoveMemberMessage
  | DiagnosticClearMessage
  | DiagnosticPauseMessage
  | DiagnosticRefreshMessage
  | OpenManageTeamMessage
  | RunSetupMessage
  | SaveTeamMessage
  | AssignCharacterMessage
  | ConfirmOrphanDeleteMessage
  | DismissSetupSuggestionMessage;
