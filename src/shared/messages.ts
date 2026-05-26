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

/** Union of all host → webview messages. */
export type HostMessage =
  | StateFullMessage
  | StateDeltaMessage
  | RosterLoadedMessage
  | RosterErrorMessage;

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
 * setting toggles (e.g. post-V1 `hideIdleAgents`) without proliferating
 * message types. The host handler validates `key` against the literal-union
 * and routes to `vscode.workspace.getConfiguration("claudeteam").update(
 * key, value, vscode.ConfigurationTarget.Global)` (sponsor confirmed Global
 * per spec §8 Q3).
 *
 * Extending the `key` union is the post-V1 follow-up surface (spec §8 Q1,
 * ClickUp 86c9yyw7a) — adds new literal members, not new messages.
 */
export type SetConfigMessage = {
  type: "ui:set-config";
  payload: {
    key: "hideFinishedAgents";
    value: boolean;
  };
};

/** Union of all webview → host messages. */
export type WebviewMessage =
  | OpenTranscriptMessage
  | OpenRosterMessage
  | RefreshMessage
  | SetConfigMessage;
