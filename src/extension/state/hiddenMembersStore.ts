/**
 * hiddenMembersStore — persisted hidden-member set backed by VS Code
 * `workspaceState` (E-06a / EPIC 86ca11187 §7.2 — reversible hide-agent).
 *
 * The set survives webview reload AND window reload because `workspaceState`
 * is a `vscode.Memento` persisted by VS Code per-workspace across the entire
 * extension-host lifecycle (see `data-sources.md` cross-ref + VS Code
 * `ExtensionContext.workspaceState` docs). Workspace scope (not global) is the
 * deliberate choice: hiding "Bram" while working on project A should not hide
 * Bram when the sponsor opens project B with a different roster. (Spec §9.3
 * left the scope to Felix; workspace scope matches the per-project roster
 * default in `roster-matching.md` § Recommended default.)
 *
 * ## The ONLY mutation surface (AC4 — no auto-hide)
 *
 * The set is mutated EXCLUSIVELY by the three explicit user actions:
 *   - `hide(teamId, memberId)`     ← `ui:hide-member`
 *   - `show(teamId, memberId)`     ← `ui:show-member`
 *   - `showAll()`                  ← `ui:show-all-hidden`
 *
 * There is deliberately NO method that adds to the set based on time,
 * inactivity, tile state, or any automatic signal. Sponsor REJECTED auto-hide
 * (DECISIONS §36). The AC4 regression-guard test asserts this store exposes no
 * such path and that a no-op tick never grows the set.
 *
 * ## Storage shape
 *
 * Persisted as a `HiddenMemberKey[]` (`["teamA:bram", ...]`) — a JSON-safe
 * `string[]`, NOT a `Set` (Mementos JSON-serialize; a Set would round-trip to
 * `{}`). In memory the store holds a `Set<HiddenMemberKey>` for O(1) membership
 * tests by the filter; it re-derives the array on every write.
 *
 * Source: `team/iris-ux/whole-team-display-spec.md` §7.2 + §9.3.
 */

import {
  hiddenMemberKey,
  type HiddenMemberKey,
} from "../../shared/types.js";

/** The `workspaceState` key under which the hidden-member array persists. */
export const HIDDEN_MEMBERS_STORE_KEY = "claudeteam.hiddenMembers" as const;

/**
 * Minimal slice of `vscode.Memento` this store depends on. Declaring the
 * structural subset (instead of importing the `vscode` type) keeps the store
 * unit-testable with a plain in-memory fake — no VS Code instance required.
 */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

/**
 * Persisted hidden-member set. Construct once per `activate` with
 * `context.workspaceState`; pass the live `keys()` snapshot into
 * `applyHideMembersFilter` each tick and onto the wire as `hiddenMemberKeys`.
 */
export class HiddenMembersStore {
  private readonly memento: MementoLike;
  private readonly set: Set<HiddenMemberKey>;

  constructor(memento: MementoLike) {
    this.memento = memento;
    // Rehydrate from persisted storage. Defensive: tolerate a non-array or
    // entries that aren't strings (corrupt / hand-edited storage) — drop the
    // bad ones rather than throw, so a malformed Memento never breaks boot.
    const raw = memento.get<unknown>(HIDDEN_MEMBERS_STORE_KEY, []);
    const valid: HiddenMemberKey[] = Array.isArray(raw)
      ? raw.filter(
          (k): k is HiddenMemberKey =>
            typeof k === "string" && k.includes(":"),
        )
      : [];
    this.set = new Set(valid);
  }

  /**
   * Live read-only view of the hidden set for the filter's membership tests.
   * Returns the internal Set directly (typed `ReadonlySet`) — callers MUST NOT
   * mutate it; all mutation goes through `hide` / `show` / `showAll`.
   */
  keys(): ReadonlySet<HiddenMemberKey> {
    return this.set;
  }

  /**
   * Snapshot the hidden set as a JSON-safe `HiddenMemberKey[]` for the wire
   * (`AgentTree.hiddenMemberKeys`). A fresh array each call — safe to hand to
   * `serializeState` / `postState`.
   */
  toArray(): HiddenMemberKey[] {
    return [...this.set];
  }

  /**
   * Hide a member (explicit user action — `ui:hide-member`). Idempotent:
   * hiding an already-hidden member is a no-op (the persisted write still
   * fires harmlessly, but the resulting array is unchanged). Returns the
   * persistence promise so the caller can `void` it / await as needed.
   */
  hide(teamId: string, memberId: string): Thenable<void> {
    this.set.add(hiddenMemberKey(teamId, memberId));
    return this.persist();
  }

  /**
   * Un-hide a single member (explicit user action — `ui:show-member`).
   * Idempotent: showing a not-hidden member is a no-op.
   */
  show(teamId: string, memberId: string): Thenable<void> {
    this.set.delete(hiddenMemberKey(teamId, memberId));
    return this.persist();
  }

  /**
   * Clear the entire hidden set (explicit user action — `ui:show-all-hidden`).
   * Every previously-hidden member returns to the default view on the next
   * tick.
   */
  showAll(): Thenable<void> {
    this.set.clear();
    return this.persist();
  }

  /** Persist the in-memory Set as a JSON-safe array to `workspaceState`. */
  private persist(): Thenable<void> {
    return this.memento.update(HIDDEN_MEMBERS_STORE_KEY, [...this.set]);
  }
}
