/**
 * removedMembersStore — persisted removed-member set backed by VS Code
 * `workspaceState` (E-07a / EPIC 86ca11187 §7.3 — yaml-gated remove-agent).
 *
 * Sibling of `hiddenMembersStore.ts`, but with DIFFERENT semantics:
 *
 *   - **Hide** is reversible in-UI: a hidden member is suppressed from the
 *     default tree but resurfaces under "show hidden", and one click un-hides.
 *   - **Remove** is MORE PERMANENT (DECISIONS §30 / spec §7.3): a removed
 *     member is suppressed from BOTH the default tree AND the hidden-reveal set,
 *     and there is NO in-UI un-remove. Restore is YAML-gated only.
 *
 * The set survives webview reload AND window reload (workspaceState is a
 * per-workspace `vscode.Memento`). Workspace scope (not global) matches the
 * per-project-roster default and the hide store's choice.
 *
 * ## The mutation surface (AC4 — no auto-remove)
 *
 *   - `remove(teamId, memberId)`  ← `ui:remove-member` (the ONLY user-driven add)
 *   - `reconcile(roster)`         ← roster-reload reinstate path (yaml-gated
 *                                    restore — see below). This is NOT an
 *                                    auto-remove path; it only ever SHRINKS the
 *                                    set (clears records when a member is
 *                                    re-added to teams.yaml).
 *
 * There is deliberately NO method that adds to the set based on time,
 * inactivity, or tile state. Sponsor REJECTED auto-hide/auto-remove
 * (DECISIONS §36).
 *
 * ## The yaml-gated reinstate (reconcile) — absent→present arm semantics
 *
 * A removed member returns ONLY by re-adding its block to `teams.yaml`. The
 * challenge: with the recommended guided-manual-edit remove flow (spec §7.3
 * option B), the member is still PRESENT in the roster at the instant of
 * removal (the sponsor hasn't deleted the block yet). A naive "drop the record
 * if the member is in the roster" reconcile would immediately self-undo the
 * removal on the very next reload.
 *
 * The fix is a two-phase arm: each removed key is tracked as "armed" or not.
 *
 *   1. `remove()` adds the key UN-ARMED — it suppresses the tile but is not yet
 *      eligible for yaml-gated reinstate.
 *   2. `reconcile(roster)` runs on every roster reload:
 *        • If a removed key's member is ABSENT from the roster → ARM the key
 *          (the sponsor has now deleted the block — a future re-add is the
 *          reinstate signal).
 *        • If an ARMED key's member is PRESENT in the roster → the member was
 *          re-added; CLEAR the record (reinstate). The tile reappears.
 *        • An UN-ARMED key whose member is still present stays removed (the
 *          sponsor hasn't deleted the block yet; the immediate suppression
 *          holds).
 *
 * This makes the absent→present transition the precise reinstate trigger,
 * matching DECISIONS §30 ("returns ONLY by re-adding to teams.yaml") without
 * self-undoing on the post-remove reload.
 *
 * ## Storage shape
 *
 * Persisted as a JSON-safe object map `{ "teamA:bram": { armed: boolean } }`
 * under `claudeteam.removedMembers`. (A bare `string[]` cannot carry the armed
 * flag; a `Map`/`Set` would JSON-round-trip to `{}`.) In memory the store holds
 * a `Map<RemovedMemberKey, { armed: boolean }>`; the filter/wire consume
 * `keys()` (a `ReadonlySet`) which is state-independent of the armed flag.
 *
 * Source: `team/iris-ux/whole-team-display-spec.md` §7.3 + DECISIONS §30.
 */

import {
  removedMemberKey,
  type RemovedMemberKey,
  type Team,
} from "../../shared/types.js";

/** The `workspaceState` key under which the removed-member map persists. */
export const REMOVED_MEMBERS_STORE_KEY = "claudeteam.removedMembers" as const;

/**
 * Minimal slice of `vscode.Memento` this store depends on (mirror of
 * `hiddenMembersStore.MementoLike`). Declaring the structural subset keeps the
 * store unit-testable with a plain in-memory fake — no VS Code instance needed.
 */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

/** Per-key persisted record. `armed` gates the yaml-gated reinstate. */
interface RemovedRecord {
  /**
   * True once a roster reload has observed the member ABSENT from the roster
   * (the sponsor deleted the block). An armed record is reinstated when the
   * member later reappears in the roster. See the class doc's reconcile
   * semantics.
   */
  armed: boolean;
}

/**
 * Persisted removed-member set. Construct once per `activate` with
 * `context.workspaceState`; pass the live `keys()` snapshot into
 * `applyRemoveMembersFilter` each tick and onto the wire as `removedMemberKeys`.
 * Call `reconcile(roster)` on every roster reload to drive the yaml-gated
 * reinstate.
 */
export class RemovedMembersStore {
  private readonly memento: MementoLike;
  private readonly map: Map<RemovedMemberKey, RemovedRecord>;

  constructor(memento: MementoLike) {
    this.memento = memento;
    // Rehydrate from persisted storage. Defensive: tolerate a non-object or
    // entries that aren't well-formed (corrupt / hand-edited storage) — drop
    // the bad ones rather than throw, so a malformed Memento never breaks boot.
    // Back-compat: also accept a bare `string[]` (treat each as un-armed) in
    // case an earlier shape was ever written.
    const raw = memento.get<unknown>(REMOVED_MEMBERS_STORE_KEY, {});
    this.map = new Map();
    if (Array.isArray(raw)) {
      for (const k of raw) {
        if (typeof k === "string" && k.includes(":")) {
          this.map.set(k as RemovedMemberKey, { armed: false });
        }
      }
    } else if (raw !== null && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!k.includes(":")) continue;
        const armed =
          v !== null &&
          typeof v === "object" &&
          (v as Record<string, unknown>)["armed"] === true;
        this.map.set(k as RemovedMemberKey, { armed });
      }
    }
  }

  /**
   * Live read-only view of the removed-key set for the filter's membership
   * tests AND the wire. Callers MUST NOT mutate it; all mutation goes through
   * `remove` / `reconcile`. The armed flag is internal — `keys()` exposes
   * membership only (a removed member is suppressed whether armed or not).
   */
  keys(): ReadonlySet<RemovedMemberKey> {
    return new Set(this.map.keys());
  }

  /**
   * Snapshot the removed set as a JSON-safe `RemovedMemberKey[]` for the wire
   * (`AgentTree.removedMemberKeys`). A fresh array each call.
   */
  toArray(): RemovedMemberKey[] {
    return [...this.map.keys()];
  }

  /**
   * Remove a member (explicit user action — `ui:remove-member`). Added
   * UN-ARMED: it suppresses the tile immediately but is not yet eligible for
   * yaml-gated reinstate (the reconcile path arms it once the member leaves the
   * roster). Idempotent: removing an already-removed member is a no-op that
   * preserves the existing armed flag. Returns the persistence promise.
   */
  remove(teamId: string, memberId: string): Thenable<void> {
    const key = removedMemberKey(teamId, memberId);
    if (!this.map.has(key)) {
      this.map.set(key, { armed: false });
    }
    return this.persist();
  }

  /**
   * Reconcile the removed set against a freshly-loaded roster (called on every
   * roster reload). Implements the yaml-gated reinstate per the class doc:
   *
   *   - ARM any removed key whose member is now ABSENT from the roster.
   *   - REINSTATE (delete the record) any ARMED key whose member is PRESENT
   *     again (re-added to teams.yaml).
   *
   * Returns `true` when the set changed (a reinstate happened OR a key was
   * armed), so the caller can decide whether to force a re-emit. Persists only
   * when something changed. Pure read of the roster — never mutates it.
   */
  reconcile(roster: Team[]): boolean {
    // Build the set of (teamId:memberId) currently present in the roster.
    const present = new Set<RemovedMemberKey>();
    for (const team of roster) {
      for (const member of team.members) {
        present.add(removedMemberKey(team.id, member.id));
      }
    }

    let changed = false;
    for (const [key, rec] of [...this.map.entries()]) {
      const inRoster = present.has(key);
      if (!inRoster) {
        // Member is gone from the roster (sponsor deleted the block) → arm the
        // record so a future re-add reinstates it.
        if (!rec.armed) {
          rec.armed = true;
          changed = true;
        }
      } else if (rec.armed) {
        // Armed AND back in the roster → the member was re-added. Reinstate.
        this.map.delete(key);
        changed = true;
      }
      // (Un-armed + still in roster → leave removed; the sponsor hasn't deleted
      //  the block yet, so the immediate suppression must hold.)
    }

    if (changed) void this.persist();
    return changed;
  }

  /** Persist the in-memory map as a JSON-safe object to `workspaceState`. */
  private persist(): Thenable<void> {
    const obj: Record<string, RemovedRecord> = {};
    for (const [k, v] of this.map) obj[k] = { armed: v.armed };
    return this.memento.update(REMOVED_MEMBERS_STORE_KEY, obj);
  }
}
