/**
 * spriteTracker — webview-local sprite playback state per rostered member.
 *
 * Two jobs, both ephemeral-UI concerns the host knows nothing about:
 *
 *   1. Idle-episode stickiness. A tile is fully re-rendered every ~2s poll
 *      tick. Without memory, the idle-pool pick (which idle pose loops) would
 *      re-roll every tick — the character would jarringly swap coffee→snack→
 *      phone every 2 seconds. The tracker remembers the prior pick + whether
 *      the prior pose was active, so the player keeps the same idle pose for
 *      the whole idle EPISODE and only re-rolls on a fresh episode
 *      (active→idle transition). Mirrors prevStateTracker's lifecycle.
 *
 *   2. Timer disposal. Each render creates a fresh `SpriteBoxHandle` with its
 *      own frame timer. The OLD handle's timer must be cleared or it keeps
 *      mutating a detached <img> forever (leak). The tracker holds the live
 *      handle's `dispose` and calls it before storing the new one.
 *
 * Keyed by `{sessionId}:{memberId}` (NOT agentId) — a baseline `available`
 * tile carries `agentId: ""`, and a member's identity persists across its
 * state changes; memberId is the stable sprite-owner key.
 *
 * Source: team/iris-ux/whole-team-display-spec.md §3.3 (idle-episode stickiness)
 */

type SpriteKey = `${string}:${string}`;

interface SpriteEntry {
  idlePick: string | null;
  /** Active-pool pick the prior box used (null if idle / active_read / no pool). */
  activePick: string | null;
  isActive: boolean;
  dispose: () => void;
  /** Canonical pose the prior box played (for resume pose-match guard). */
  pose: string;
  /** Reads the prior box's live playback position at re-render time. */
  currentFrame: () => { frameIdx: number; direction: number; elapsedMs: number };
}

/**
 * The prior box's playback position threaded into the next render so the cycle
 * RESUMES instead of restarting at the window start (E1 live-preview fix
 * 86ca2c4t8). `pose` lets the player verify the pose is unchanged before
 * resuming. Undefined when there is no prior box for this member.
 */
export interface PriorPlayback {
  pose: string;
  frameIdx: number;
  direction: number;
  /**
   * Wall-clock ms the prior box's displayed frame had already been on screen,
   * read at re-render time. Threaded so the next box can step PAST a frame that
   * already got its full base hold (≥ frameMs) instead of re-showing it forever
   * — the 86ca3a7x3 freeze fix. See spritePlayer `SpriteBoxHandle.currentFrame`.
   */
  elapsedMs: number;
}

export interface SpriteTracker {
  /** Prior idle pick for this member (undefined if none / prior was active). */
  priorIdlePick(sessionId: string, memberId: string): string | undefined;
  /**
   * Prior active-pool pick for this member (undefined if none / prior was idle /
   * prior was `active_read`). Threaded so an active working episode keeps the
   * same anim across re-renders (ticket 86ca3mge9).
   */
  priorActivePick(sessionId: string, memberId: string): string | undefined;
  /** Whether the prior render's pose for this member was active. */
  priorWasActive(sessionId: string, memberId: string): boolean;
  /**
   * The prior box's pose + current playback position for this member, read at
   * re-render time so the next box resumes the in-flight cycle (E1 fix
   * 86ca2c4t8). Undefined when there is no prior box.
   */
  priorPlayback(sessionId: string, memberId: string): PriorPlayback | undefined;
  /**
   * Register the freshly-rendered sprite handle. Disposes any prior handle's
   * timer for this key first (prevents detached-img timer leaks), then stores
   * the new pick / active flag / pose / position-reader / disposer.
   */
  register(
    sessionId: string,
    memberId: string,
    entry: {
      idlePick: string | null;
      activePick: string | null;
      isActive: boolean;
      dispose: () => void;
      pose: string;
      currentFrame: () => { frameIdx: number; direction: number; elapsedMs: number };
    },
  ): void;
  /**
   * Dispose + drop entries whose tile is no longer rendered. Pass the set of
   * `{sessionId}:{memberId}` keys present this tick; everything else is
   * disposed (timer cleared) and removed.
   */
  prune(currentKeys: Set<SpriteKey>): void;
  /** Test/debug — count of tracked entries. */
  size(): number;
}

export function createSpriteTracker(): SpriteTracker {
  const entries = new Map<SpriteKey, SpriteEntry>();

  return {
    priorIdlePick(sessionId, memberId) {
      const e = entries.get(`${sessionId}:${memberId}`);
      return e ? (e.idlePick ?? undefined) : undefined;
    },
    priorActivePick(sessionId, memberId) {
      const e = entries.get(`${sessionId}:${memberId}`);
      return e ? (e.activePick ?? undefined) : undefined;
    },
    priorWasActive(sessionId, memberId) {
      const e = entries.get(`${sessionId}:${memberId}`);
      return e ? e.isActive : false;
    },
    priorPlayback(sessionId, memberId) {
      const e = entries.get(`${sessionId}:${memberId}`);
      if (!e) return undefined;
      const { frameIdx, direction, elapsedMs } = e.currentFrame();
      return { pose: e.pose, frameIdx, direction, elapsedMs };
    },
    register(sessionId, memberId, entry) {
      const key: SpriteKey = `${sessionId}:${memberId}`;
      const prior = entries.get(key);
      if (prior) {
        prior.dispose();
      }
      entries.set(key, entry);
    },
    prune(currentKeys) {
      for (const [key, entry] of entries) {
        if (!currentKeys.has(key)) {
          entry.dispose();
          entries.delete(key);
        }
      }
    },
    size() {
      return entries.size;
    },
  };
}
