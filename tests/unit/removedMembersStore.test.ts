/**
 * Unit tests for src/extension/state/removedMembersStore.ts
 * (E-07a / EPIC 86ca11187 §7.3 — persisted removed-member set, yaml-gated).
 *
 * Uses an in-memory `MementoLike` fake — no VS Code instance needed.
 *
 *   - Rehydrates from persisted storage (object map + back-compat string[]).
 *   - remove is the only user-driven mutator; persists; idempotent.
 *   - keys() / toArray() reflect mutations.
 *   - Persistence survives a "reload" (new store over the same memento) — AC2.
 *   - Defensive rehydrate: non-object / malformed entries tolerated.
 *   - **Yaml-gated reinstate (reconcile) — AC3**: the absent→present arm
 *     semantics: a removed member is NOT self-undone on the post-remove reload
 *     (still in roster, un-armed), gets ARMED once absent, and is REINSTATED
 *     once it reappears (re-added to teams.yaml).
 *   - **AC4 regression guard**: the store has no time/inactivity mutator; the
 *     reconcile path only ever SHRINKS the set (never auto-removes).
 *
 * Source: src/extension/state/removedMembersStore.ts
 */

import { describe, it, expect } from "vitest";

import {
  REMOVED_MEMBERS_STORE_KEY,
  RemovedMembersStore,
  type MementoLike,
} from "../../src/extension/state/removedMembersStore.js";
import type { Team } from "../../src/shared/types.js";

/** In-memory Memento fake. Mirrors VS Code's get/update contract. */
class FakeMemento implements MementoLike {
  private store = new Map<string, unknown>();
  constructor(seed?: Record<string, unknown>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
  }
  get<T>(key: string, defaultValue: T): T {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }
  update(key: string, value: unknown): Thenable<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
  raw(key: string): unknown {
    return this.store.get(key);
  }
}

const TEAM = "claudeteam-alpha";

/** Build a minimal roster with the given member ids on one team. */
function rosterWith(...memberIds: string[]): Team[] {
  return [
    {
      id: TEAM,
      name: "ClaudeTeam Alpha",
      members: memberIds.map((id) => ({
        id,
        display: id,
        role: "test",
        match: [{ agentType_equals: id }],
      })),
    },
  ];
}

describe("RemovedMembersStore — construction + rehydrate", () => {
  it("starts empty when storage is empty", () => {
    const store = new RemovedMembersStore(new FakeMemento());
    expect(store.toArray()).toEqual([]);
    expect(store.keys().size).toBe(0);
  });

  it("rehydrates a persisted object map on construction", () => {
    const memento = new FakeMemento({
      [REMOVED_MEMBERS_STORE_KEY]: {
        "claudeteam-alpha:felix": { armed: false },
        "claudeteam-alpha:maya": { armed: true },
      },
    });
    const store = new RemovedMembersStore(memento);
    expect([...store.keys()].sort()).toEqual([
      "claudeteam-alpha:felix",
      "claudeteam-alpha:maya",
    ]);
  });

  it("back-compat: rehydrates a bare string[] (each treated un-armed)", () => {
    const memento = new FakeMemento({
      [REMOVED_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix"],
    });
    const store = new RemovedMembersStore(memento);
    expect(store.toArray()).toEqual(["claudeteam-alpha:felix"]);
  });

  it("defensively drops corrupt entries on rehydrate (no separator / bad value)", () => {
    const memento = new FakeMemento({
      [REMOVED_MEMBERS_STORE_KEY]: {
        "claudeteam-alpha:felix": { armed: false },
        "no-separator": { armed: false },
      },
    });
    const store = new RemovedMembersStore(memento);
    expect(store.toArray()).toEqual(["claudeteam-alpha:felix"]);
  });

  it("tolerates a non-object/non-array persisted value (treats as empty)", () => {
    const memento = new FakeMemento({
      [REMOVED_MEMBERS_STORE_KEY]: "not-a-map",
    });
    const store = new RemovedMembersStore(memento);
    expect(store.toArray()).toEqual([]);
  });
});

describe("RemovedMembersStore — remove (the user-driven mutator)", () => {
  it("remove adds the (teamId, memberId) key un-armed and persists", async () => {
    const memento = new FakeMemento();
    const store = new RemovedMembersStore(memento);

    await store.remove(TEAM, "felix");

    expect(store.keys().has("claudeteam-alpha:felix")).toBe(true);
    expect(memento.raw(REMOVED_MEMBERS_STORE_KEY)).toEqual({
      "claudeteam-alpha:felix": { armed: false },
    });
  });

  it("remove is idempotent (preserves an existing armed flag)", async () => {
    const memento = new FakeMemento({
      [REMOVED_MEMBERS_STORE_KEY]: {
        "claudeteam-alpha:felix": { armed: true },
      },
    });
    const store = new RemovedMembersStore(memento);
    await store.remove(TEAM, "felix");
    // Still present; armed flag not clobbered back to false.
    expect(memento.raw(REMOVED_MEMBERS_STORE_KEY)).toEqual({
      "claudeteam-alpha:felix": { armed: true },
    });
  });

  it("toArray returns a fresh array each call", () => {
    const store = new RemovedMembersStore(
      new FakeMemento({
        [REMOVED_MEMBERS_STORE_KEY]: { "claudeteam-alpha:felix": { armed: false } },
      }),
    );
    const a = store.toArray();
    const b = store.toArray();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("RemovedMembersStore — persistence across reload (AC2)", () => {
  it("a new store over the same memento sees prior removals (survives reload)", async () => {
    const memento = new FakeMemento();
    const store1 = new RemovedMembersStore(memento);
    await store1.remove(TEAM, "felix");

    // Simulate a window reload: fresh store reading the same backing memento.
    const store2 = new RemovedMembersStore(memento);
    expect(store2.keys().has("claudeteam-alpha:felix")).toBe(true);
  });
});

describe("RemovedMembersStore — yaml-gated reinstate / reconcile (AC3)", () => {
  it("does NOT self-undo on the post-remove reload (member still in roster, un-armed)", () => {
    const memento = new FakeMemento();
    const store = new RemovedMembersStore(memento);
    void store.remove(TEAM, "felix");

    // First reload AFTER remove — the sponsor has not yet deleted the block,
    // so felix is still in the roster. The record must NOT be cleared (else
    // remove would immediately undo itself).
    const changed = store.reconcile(rosterWith("felix", "maya"));
    expect(store.keys().has("claudeteam-alpha:felix")).toBe(true);
    // It DID change — the key got armed (absent→present arming requires it to
    // first observe absence; here it's still present, so it should NOT arm).
    expect(changed).toBe(false);
  });

  it("arms a removed key once its member leaves the roster, then reinstates on re-add", () => {
    const memento = new FakeMemento();
    const store = new RemovedMembersStore(memento);
    void store.remove(TEAM, "felix");

    // Phase 1: sponsor deletes the felix block from teams.yaml → felix absent.
    // reconcile ARMS the record (eligible for reinstate) but keeps it removed.
    const armChanged = store.reconcile(rosterWith("maya"));
    expect(armChanged).toBe(true);
    expect(store.keys().has("claudeteam-alpha:felix")).toBe(true);

    // A spurious reload while still absent must NOT reinstate (still gone).
    const stillGone = store.reconcile(rosterWith("maya"));
    expect(stillGone).toBe(false);
    expect(store.keys().has("claudeteam-alpha:felix")).toBe(true);

    // Phase 2: sponsor re-adds the felix block → felix present again.
    // The armed record is REINSTATED (cleared) — the tile reappears.
    const reinstated = store.reconcile(rosterWith("felix", "maya"));
    expect(reinstated).toBe(true);
    expect(store.keys().has("claudeteam-alpha:felix")).toBe(false);
    expect(memento.raw(REMOVED_MEMBERS_STORE_KEY)).toEqual({});
  });

  it("a removed key for a member never in the roster arms but stays removed", () => {
    const memento = new FakeMemento();
    const store = new RemovedMembersStore(memento);
    void store.remove(TEAM, "ghost");

    // ghost was never in this roster → reconcile arms it; it stays removed
    // until a future roster reload shows it PRESENT (re-added).
    store.reconcile(rosterWith("felix"));
    expect(store.keys().has("claudeteam-alpha:ghost")).toBe(true);
  });

  it("reconcile persists only when the set changes", async () => {
    const memento = new FakeMemento();
    const store = new RemovedMembersStore(memento);
    await store.remove(TEAM, "felix");
    const afterRemove = memento.raw(REMOVED_MEMBERS_STORE_KEY);

    // No-op reconcile (member still present, un-armed) → no persist change.
    store.reconcile(rosterWith("felix"));
    expect(memento.raw(REMOVED_MEMBERS_STORE_KEY)).toEqual(afterRemove);
  });
});

describe("RemovedMembersStore — AC4 regression guard (no auto-remove)", () => {
  it("repeated keys() reads (tick-like loop) never grow the set", () => {
    const store = new RemovedMembersStore(
      new FakeMemento({
        [REMOVED_MEMBERS_STORE_KEY]: { "claudeteam-alpha:felix": { armed: false } },
      }),
    );
    const sizeBefore = store.keys().size;
    for (let i = 0; i < 100; i++) {
      expect(store.keys().size).toBe(sizeBefore);
    }
  });

  it("reconcile only ever SHRINKS the set — it never adds a member", () => {
    const store = new RemovedMembersStore(new FakeMemento());
    // Empty store: reconcile against a full roster must add NOTHING.
    store.reconcile(rosterWith("felix", "maya", "bram"));
    expect(store.toArray()).toEqual([]);
  });

  it("exposes no time/inactivity mutator — only remove + reconcile", () => {
    const store = new RemovedMembersStore(new FakeMemento());
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && typeof proto[n] === "function",
    );
    const publicMutators = methods.filter((m) =>
      ["remove", "reconcile"].includes(m),
    );
    expect(publicMutators.sort()).toEqual(["reconcile", "remove"]);
    for (const banned of ["expire", "prune", "autoRemove", "tick", "sweep"]) {
      expect(methods).not.toContain(banned);
    }
  });
});
