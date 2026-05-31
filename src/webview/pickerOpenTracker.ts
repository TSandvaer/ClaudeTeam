/**
 * pickerOpenTracker — webview-local persistence of the per-member character-
 * picker popover's open state across Manage Team panel re-renders (ticket
 * 86ca1u41m, BUG B).
 *
 * The problem this solves
 *
 *   While the Manage Team panel is open (`managePanelOpen === true`),
 *   `renderFull` rebuilds the ENTIRE panel DOM on every host `state:full` /
 *   `setup:detection` tick (~2s default poll — `claudeteam.pollIntervalMs`).
 *   The character picker's open/closed state lived ONLY in the freshly-built
 *   DOM (`pickerHost.firstChild !== null`), so a user who clicked "Character:
 *   pick ▸" to open the picker saw it vanish on the very next poll tick — the
 *   rebuilt row constructs an empty `pickerHost` again.
 *
 *   This is the SAME bug class as the overflow-menu auto-close (86ca1fjqu /
 *   `menuOpenTracker`) and the badge-expand snap-shut (Obs 10 /
 *   `expandedGroupsTracker`). The fix is the same: capture the open intent at
 *   click time, re-apply it when the next render pass reconstructs the row so
 *   the picker renders already-open. The picker still closes on a deliberate
 *   user action — select a character, Clear, the ✕ close button, or Esc — which
 *   clears the tracker entry so it does NOT resurrect on the next tick.
 *
 * Key shape — `memberId` alone — because only one picker can be open at a time
 * per member row, and the picker lives inside the (single) Manage Team panel,
 * NOT per-session-tile. Unlike `menuOpenTracker` (`sessionId:teamId:memberId`),
 * the panel is session-independent, so the member id is the full identity.
 *
 * Persistence scope (identical to menuOpenTracker / expandedGroupsTracker):
 *   - Survives poll-tick `renderFull` (the load-bearing case).
 *   - Does NOT survive webview reload (a coarse user action).
 *   - Does NOT survive across VS Code sessions (transient interaction, not
 *     config — no `vscode.setState`).
 *
 * Why ephemeral here (not in the host wire shape): picker open-state is a
 * webview UI concern, not domain state — the host should not know which member's
 * picker the user has open (`.claude/docs/vscode-extension-conventions.md` §
 * "Webview rules" — state minimalism).
 *
 * Source: ClickUp 86ca1u41m (BUG B — picker closes on poll re-render); pattern
 *         parallels menuOpenTracker.ts (86ca1fjqu).
 */

/** Public surface of the tracker — single instance per webview boot. */
export interface PickerOpenTracker {
  /** Whether the picker for `memberId` is currently open. Unknown → closed. */
  isOpen(memberId: string): boolean;

  /**
   * Record the user's open intent. `false` clears the entry (closed → does NOT
   * re-open on the next tick — principle of least surprise, parallel to
   * menuOpenTracker.setPhase(null)).
   */
  setOpen(memberId: string, open: boolean): void;

  /**
   * Prune entries whose member is no longer present in the panel. Pass the set
   * of currently-rendered member ids; everything else is removed. Keeps the Map
   * bounded as the roster changes.
   */
  prune(currentMemberIds: Set<string>): void;

  /** Test/debug surface — count of tracked (open) entries. */
  size(): number;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createPickerOpenTracker(): PickerOpenTracker {
  const open = new Set<string>();

  return {
    isOpen(memberId: string): boolean {
      return open.has(memberId);
    },

    setOpen(memberId: string, isOpen: boolean): void {
      if (isOpen) {
        open.add(memberId);
      } else {
        open.delete(memberId);
      }
    },

    prune(currentMemberIds: Set<string>): void {
      for (const id of Array.from(open)) {
        if (!currentMemberIds.has(id)) {
          open.delete(id);
        }
      }
    },

    size(): number {
      return open.size;
    },
  };
}
