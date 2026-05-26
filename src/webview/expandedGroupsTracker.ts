/**
 * expandedGroupsTracker — webview-local persistence of CollapsedPersonaGroup
 * expand/collapse state across re-renders (Obs 10, ClickUp 86c9zfmh1).
 *
 * Pure webview state (`Set<string>` of expanded group keys). Mirrors the
 * `finishedTracker` / `prevStateTracker` lifecycle pattern so the webview
 * owns this ephemeral UI concern without duplicating host data.
 *
 * The problem this solves
 *
 *   `renderFull` rebuilds the entire DOM on every host `state:full` tick
 *   (~2s default poll). Without persistent state, each new
 *   `renderCollapsedPersonaTile` call constructs a fresh `<section>` with
 *   `data-expanded="false"` — any user click that expanded a wrapper is
 *   wiped on the next tick. Sponsor verbatim symptom: "If i click on bram
 *   i see image 2, but it closes in 1 second everytime i try to expand a
 *   finished agent."
 *
 *   The fix is to capture user expansion intent at click time, and re-apply
 *   it during the next `renderCollapsedPersonaTile` constructor pass so the
 *   freshly-built wrapper renders already-expanded.
 *
 * Lifecycle per key:
 *   - First render where the key is observed → tracker has no entry →
 *     wrapper renders collapsed (default). The wrapper's click handler
 *     calls `setExpanded(key, true)` on first user click.
 *   - Subsequent renders → `isExpanded(key)` returns `true` for any group
 *     the user previously expanded. Wrapper renders pre-expanded.
 *   - Tile-wrapper disappears between renders → `prune(...)` removes the
 *     entry on the next render pass, parallel to the other trackers.
 *
 * Persistence scope:
 *   - Survives `forceRefresh` / poll-tick `renderFull` (the load-bearing
 *     case — sponsor's reported symptom).
 *   - Does NOT survive webview reload (acceptable — reload is a coarse
 *     user action; equivalent to fresh dashboard boot).
 *   - Does NOT survive across VS Code sessions (no `vscode.setState`
 *     persistence — expansion is a transient interaction, not config).
 *
 * Key shape — `${sessionId}:${teamId}:${personaName}`:
 *   - `sessionId` scopes per Claude Code session: a Felix wrapper in
 *     session A and a Felix wrapper in session B track independently.
 *   - `teamId` scopes per team: a "Bram" persona that appears under two
 *     different teams (rare edge case but possible per roster shape) keeps
 *     each team's expansion state independent.
 *   - `personaName` is the wrapper's discriminator — same as the
 *     `dataset.personaName` exposed on the wrapper section, so the key is
 *     readable from the DOM directly if needed for debugging.
 *
 * Why ephemeral here (not in the host `CollapsedPersonaGroup` shape):
 *   - Expand/collapse is a webview UI concern, not domain state. The host
 *     reducer should not know which wrappers the user has expanded.
 *   - State that already exists in the extension host should NOT be
 *     duplicated in the webview per
 *     `.claude/docs/vscode-extension-conventions.md` § "Webview rules".
 *   - Webview-local state is the correct surface for ephemeral UI
 *     concerns (hover, scroll, expansion, transition tracking).
 *
 * Source: ClickUp 86c9zfmh1 (Obs 10 — preserve collapsed-group expansion
 *         state across re-renders)
 */

/**
 * Key shape: "{sessionId}:{teamId}:{personaName}".
 *
 * Composed at the renderCollapsedPersonaTile call-site (teamCard.ts owns
 * sessionId + teamId; the wrapper owns personaName).
 */
export type ExpandedGroupKey = `${string}:${string}:${string}`;

/** Public surface of the tracker — single instance per webview boot. */
export interface ExpandedGroupsTracker {
  /**
   * Compose a tracker key from the three identity parts. Centralized so
   * the key shape stays in one place — callers don't manually
   * string-concatenate. The wrapper component and the prune pass MUST use
   * this same composition or entries leak.
   */
  makeKey(
    sessionId: string,
    teamId: string,
    personaName: string,
  ): ExpandedGroupKey;

  /**
   * Return whether the wrapper identified by `key` was expanded by the
   * user during this webview session. Returns `false` for unknown keys
   * (default-collapsed semantics).
   *
   * Read-only — does not mutate the tracker. The wrapper component calls
   * this once in its constructor to choose the initial render state.
   */
  isExpanded(key: ExpandedGroupKey): boolean;

  /**
   * Record the user's expansion intent. Called by the wrapper's click
   * handler whenever the user toggles. `expanded=true` adds the key;
   * `expanded=false` removes it (so a collapsed-by-the-user wrapper does
   * NOT re-expand on the next tick — matches the principle of least
   * surprise).
   */
  setExpanded(key: ExpandedGroupKey, expanded: boolean): void;

  /**
   * Prune entries whose wrapper is no longer present in the dashboard.
   * Pass the set of currently-rendered (sessionId:teamId:personaName)
   * keys; everything else is removed. Called once per render pass in
   * `renderFull` alongside the other trackers — keeps the Set bounded as
   * teams come and go (e.g. ClaudeTeam Alpha disappears when its sessions
   * die; we shouldn't keep its expansion state forever).
   */
  prune(currentKeys: Set<ExpandedGroupKey>): void;

  /** Test/debug surface — count of tracked entries. */
  size(): number;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createExpandedGroupsTracker(): ExpandedGroupsTracker {
  const expanded = new Set<ExpandedGroupKey>();

  return {
    makeKey(
      sessionId: string,
      teamId: string,
      personaName: string,
    ): ExpandedGroupKey {
      return `${sessionId}:${teamId}:${personaName}`;
    },

    isExpanded(key: ExpandedGroupKey): boolean {
      return expanded.has(key);
    },

    setExpanded(key: ExpandedGroupKey, isExpanded: boolean): void {
      if (isExpanded) {
        expanded.add(key);
      } else {
        expanded.delete(key);
      }
    },

    prune(currentKeys: Set<ExpandedGroupKey>): void {
      for (const key of Array.from(expanded)) {
        if (!currentKeys.has(key)) {
          expanded.delete(key);
        }
      }
    },

    size(): number {
      return expanded.size;
    },
  };
}
