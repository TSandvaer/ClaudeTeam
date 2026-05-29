/**
 * menuOpenTracker — webview-local persistence of the per-tile overflow ("⋯")
 * menu's open state across re-renders (ticket 86ca1fjqu, BUG 2).
 *
 * The problem this solves
 *
 *   `renderFull` rebuilds the entire dashboard DOM on every host `state:full`
 *   tick (~2s default poll — `claudeteam.pollIntervalMs`). The overflow menu's
 *   open/closed state lived ONLY in the freshly-built DOM (`menu.hidden`), so a
 *   user who clicked "⋯" to open the menu saw it vanish on the very next poll
 *   tick — the rebuilt tile constructs its menu with `hidden = true` again.
 *   Sponsor GUI-test symptom (2026-05-29, dashboard live on main `b648cf2`):
 *   "clicking ⋯ opens the menu then it vanishes before any interaction."
 *
 *   This is the SAME bug class the `expandedGroupsTracker` (Obs 10) solves for
 *   the badge-expand instance list — and the fix is the same: capture the open
 *   intent at click time, re-apply it when the next render pass reconstructs the
 *   tile so the menu (or its remove-confirm sub-panel) renders already-open.
 *
 *   It is a DISTINCT tracker from `expandedGroupsTracker` because the two
 *   concerns are independent: a multi-agent tile can have its instance list
 *   expanded AND its overflow menu closed, or vice versa. Conflating them in one
 *   Set would couple the two surfaces.
 *
 * Three open phases per key — the menu has a two-step remove flow (menu →
 * confirm panel), and BOTH steps must survive a poll tick:
 *   - `null`      — nothing open (the resting tile).
 *   - `"menu"`    — the hide/remove menu is open.
 *   - `"confirm"` — the remove-confirm panel is open (the second step).
 * Without tracking `"confirm"` separately, a user mid-remove-confirm would have
 * the panel snap back to the closed menu on the next tick.
 *
 * Key shape — `${sessionId}:${teamId}:${memberId}` — matches the overflow
 * surface's identity (the menu acts on the rostered MEMBER, the whole tile),
 * mirroring `expandedGroupsTracker`'s composition so render.ts can prune both
 * trackers off the same walk.
 *
 * Persistence scope (identical to expandedGroupsTracker):
 *   - Survives poll-tick `renderFull` (the load-bearing case).
 *   - Does NOT survive webview reload (a coarse user action).
 *   - Does NOT survive across VS Code sessions (transient interaction, not
 *     config — no `vscode.setState`).
 *
 * Why ephemeral here (not in the host wire shape): menu open-state is a webview
 * UI concern, not domain state — the host reducer should not know which tile's
 * menu the user has open (`.claude/docs/vscode-extension-conventions.md` §
 * "Webview rules" — state minimalism).
 *
 * Source: ClickUp 86ca1fjqu (overflow-menu BUG 2 — menu auto-closes on poll
 *         re-render); pattern parallels expandedGroupsTracker.ts (Obs 10).
 */

/** Key shape: "{sessionId}:{teamId}:{memberId}". */
export type MenuOpenKey = `${string}:${string}:${string}`;

/** The three open phases a tile's overflow surface can be in. */
export type MenuOpenPhase = "menu" | "confirm";

/** Public surface of the tracker — single instance per webview boot. */
export interface MenuOpenTracker {
  /**
   * Compose a tracker key from the three identity parts. Centralized so the
   * key shape stays in one place; the overflow component and the prune pass
   * MUST use this same composition or entries leak.
   */
  makeKey(sessionId: string, teamId: string, memberId: string): MenuOpenKey;

  /**
   * Return the open phase for the surface identified by `key`, or `null` when
   * nothing is open (the default — an unknown key is closed). Read-only — the
   * overflow component calls this once in its constructor to choose the
   * initial render phase.
   */
  phase(key: MenuOpenKey): MenuOpenPhase | null;

  /**
   * Record the user's open intent. `phase=null` clears the entry (closed →
   * does NOT re-open on the next tick — principle of least surprise, parallel
   * to expandedGroupsTracker.setExpanded(false)).
   */
  setPhase(key: MenuOpenKey, phase: MenuOpenPhase | null): void;

  /**
   * Prune entries whose tile is no longer present in the dashboard. Pass the
   * set of currently-rendered keys; everything else is removed. Called once
   * per render pass in `renderFull` alongside the other trackers — keeps the
   * Map bounded as teams / members come and go.
   */
  prune(currentKeys: Set<MenuOpenKey>): void;

  /** Test/debug surface — count of tracked (open) entries. */
  size(): number;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createMenuOpenTracker(): MenuOpenTracker {
  const open = new Map<MenuOpenKey, MenuOpenPhase>();

  return {
    makeKey(
      sessionId: string,
      teamId: string,
      memberId: string,
    ): MenuOpenKey {
      return `${sessionId}:${teamId}:${memberId}`;
    },

    phase(key: MenuOpenKey): MenuOpenPhase | null {
      return open.get(key) ?? null;
    },

    setPhase(key: MenuOpenKey, phase: MenuOpenPhase | null): void {
      if (phase === null) {
        open.delete(key);
      } else {
        open.set(key, phase);
      }
    },

    prune(currentKeys: Set<MenuOpenKey>): void {
      for (const key of Array.from(open.keys())) {
        if (!currentKeys.has(key)) {
          open.delete(key);
        }
      }
    },

    size(): number {
      return open.size;
    },
  };
}
