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
  HiddenMemberKey,
  RosterTileEntry,
  SessionTree,
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
   * Count of rostered agent tiles suppressed this tick because their state
   * was "finished" AND `claudeteam.hideFinishedAgents === true` (M5). Used by
   * the webview header chip to render "N finished hidden — show" / "hide".
   *
   * Optional + defaults to 0 — back-compat with pre-M5 consumers and with the
   * filter-off case (no count to render). Webview MUST treat `undefined` as 0.
   * See `m5-hide-finished-spec.md` §3.5 Field A + §7.1.
   */
  hiddenFinishedCount?: number;
  /**
   * Count of rostered agent tiles suppressed this tick because their state
   * was "idle" AND `claudeteam.hideIdleAgents === true` (spec 86c9zmyef).
   * Used by the webview header chip + per-team row to render
   * "N idle hidden — show" / "Hide idle".
   *
   * Optional + defaults to 0 — back-compat with pre-86c9zq9vm consumers
   * and with the filter-off case (no count to render). Webview MUST treat
   * `undefined` as 0. See `86c9zmyef-running-focused-dashboard-spec.md`
   * §3.5 Field A + §7.1.
   */
  hiddenIdleCount?: number;
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
    hideFinishedAgents?: boolean;
    /**
     * Mirror of `claudeteam.autoCollapseUniformClusters` (uniform-cluster
     * polish ticket 86c9zmqa8). See `AgentTree.config.autoCollapseUniformClusters`
     * for semantics. Optional for back-compat — webview MUST treat
     * `undefined` as `false`.
     */
    autoCollapseUniformClusters?: boolean;
    /**
     * Mirror of `claudeteam.hideIdleAgents` (spec 86c9zmyef). See
     * `AgentTree.config.hideIdleAgents` for semantics. Optional for
     * back-compat — webview MUST treat `undefined` as `false`.
     */
    hideIdleAgents?: boolean;
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

/** Union of all host → webview messages. */
export type HostMessage =
  | StateFullMessage
  | StateDeltaMessage
  | RosterLoadedMessage
  | RosterErrorMessage
  | DiagnosticStateMessage;

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
 * User toggled a config-backed dashboard setting (chip / command path).
 *
 * Generic-by-design (M5 §4.5): the `{ key, value }` shape admits future
 * setting toggles without proliferating message types. The host handler
 * validates `key` against the literal-union and routes to
 * `vscode.workspace.getConfiguration("claudeteam").update(key, value,
 * vscode.ConfigurationTarget.Global)` (sponsor confirmed Global per spec §8 Q3).
 *
 * Extending the `key` union adds new literal members, not new messages. Spec
 * 86c9zmyef §7.1 added `hideIdleAgents` to the union for the running-focused
 * dashboard's idle-filter chip.
 */
export type SetConfigMessage = {
  type: "ui:set-config";
  payload: {
    key: "hideFinishedAgents" | "hideIdleAgents";
    value: boolean;
  };
};

/**
 * User hid a rostered member from the default view (E-06a / EPIC 86ca11187
 * §7.2 — reversible hide-agent). The host adds `(teamId, memberId)` to its
 * persisted hidden-member set (`workspaceState`) and re-emits state on the
 * next tick with the member's tile suppressed from the default tree + the
 * "N hidden" count bumped.
 *
 * Distinct message type (NOT a `ui:set-config` overload) per the messages.ts
 * "add a new type, don't overload" rule: the hidden set is a dynamic
 * collection, not a scalar setting, and the action verb (add-one) is
 * semantically distinct from the show/show-all verbs below.
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

/** Union of all webview → host messages. */
export type WebviewMessage =
  | OpenTranscriptMessage
  | OpenRosterMessage
  | RefreshMessage
  | SetConfigMessage
  | HideMemberMessage
  | ShowMemberMessage
  | ShowAllHiddenMessage
  | DiagnosticClearMessage
  | DiagnosticPauseMessage
  | DiagnosticRefreshMessage;
