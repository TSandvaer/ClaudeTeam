/**
 * memberDirectory — webview-local cache of `(teamId, memberId) → {display,
 * role}` observed across ticks (E-06b / EPIC 86ca11187 §7.2).
 *
 * Why this exists: the "show hidden agents" reveal surface needs to render a
 * human-friendly "Bram (hidden) — Research" row, but the host drops hidden
 * members from the tree (E-06a filter), so their tiles are NOT present in the
 * current `state:full`. And `hiddenMemberKeys` carries only ids, not display
 * metadata. The host does not currently emit `roster:loaded` with member
 * metadata either.
 *
 * Solution: accumulate display/role from EVERY rostered tile we render. Because
 * the whole-team-always-visible epic seeds an `available` baseline tile for
 * every roster member (86ca18b9p), a member's display/role is observed at least
 * once BEFORE it can be hidden — so by the time it lands in `hiddenMemberKeys`,
 * the directory already knows its name. A cache miss (member never observed)
 * falls back to the raw memberId in the reveal row, so the unhide affordance is
 * always reachable.
 *
 * This is ephemeral webview-local UI state (allowed per
 * `vscode-extension-conventions.md` § "State minimalism" — the host owns the
 * authoritative hidden set; the directory is a render-helper cache, not
 * duplicated domain state). It is intentionally append-only within a webview
 * session — a hidden member's metadata must survive even though its tile is no
 * longer in the tree. The cache is bounded by the roster size (a handful of
 * members), so unbounded growth is not a concern.
 *
 * Source: team/iris-ux/whole-team-display-spec.md §7.2
 *         src/shared/types.ts (HiddenMemberKey, hiddenMemberKey)
 */

import type { RenderableState } from "./render.js";
import { hiddenMemberKey } from "../shared/types.js";
import { isCollapsedPersonaGroup } from "./components/collapsedPersonaTile.js";

/** Resolved display metadata for one roster member. */
export interface MemberMeta {
  display: string;
  role?: string;
}

/**
 * Append-only directory of member display metadata, keyed by the canonical
 * `HiddenMemberKey` (`teamId:memberId`) so it lines up 1:1 with the wire's
 * `hiddenMemberKeys`.
 */
export class MemberDirectory {
  private readonly byKey = new Map<string, MemberMeta>();

  /**
   * Observe every rostered tile in the given state and record its display +
   * role keyed by `(teamId, memberId)`. Idempotent — re-observing the same
   * member overwrites with the latest metadata (display/role rarely change,
   * but a roster edit could rename a member).
   *
   * Walks both bare `AgentTile` entries and `CollapsedPersonaGroup` instances
   * so members inside a collapsed wrapper still get cached.
   */
  observeState(state: RenderableState): void {
    for (const session of state.sessions) {
      for (const entries of session.rosterTiles.values()) {
        for (const entry of entries) {
          if (isCollapsedPersonaGroup(entry)) {
            for (const inst of entry.instances) {
              this.record(inst.teamId, inst.memberId, inst.display, inst.role);
            }
            continue;
          }
          this.record(entry.teamId, entry.memberId, entry.display, entry.role);
        }
      }
    }
  }

  /** Record one member's metadata. Exported indirectly via observeState. */
  private record(
    teamId: string,
    memberId: string,
    display: string,
    role: string,
  ): void {
    this.byKey.set(hiddenMemberKey(teamId, memberId), { display, role });
  }

  /**
   * Resolve a member's display metadata. Returns `null` on cache miss (member
   * never observed) so the caller can fall back to the raw memberId.
   */
  resolve(teamId: string, memberId: string): MemberMeta | null {
    return this.byKey.get(hiddenMemberKey(teamId, memberId)) ?? null;
  }
}
