/**
 * Unit tests for src/extension/state/hiddenMembersStore.ts
 * (E-06a / EPIC 86ca11187 §7.2 — persisted hidden-member set).
 *
 * Uses an in-memory `MementoLike` fake — no VS Code instance needed.
 *
 *   - Rehydrates from persisted storage on construction.
 *   - hide / show / showAll are the ONLY mutators; each persists.
 *   - keys() reflects mutations; toArray() is a fresh JSON-safe snapshot.
 *   - Idempotent hide / show.
 *   - Persistence survives a "reload" (new store over the same memento).
 *   - Defensive rehydrate: non-array / non-string-entry storage is tolerated.
 *   - **AC4 regression guard**: a tick-like read loop never grows the set; the
 *     store has no time/inactivity mutation surface.
 *
 * Source: src/extension/state/hiddenMembersStore.ts
 */

import { describe, it, expect } from "vitest";

import {
  HIDDEN_MEMBERS_STORE_KEY,
  HiddenMembersStore,
  type MementoLike,
} from "../../src/extension/state/hiddenMembersStore.js";

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
  /** Test-only peek at the raw persisted value. */
  raw(key: string): unknown {
    return this.store.get(key);
  }
}

describe("HiddenMembersStore — construction + rehydrate", () => {
  it("starts empty when storage is empty", () => {
    const store = new HiddenMembersStore(new FakeMemento());
    expect(store.toArray()).toEqual([]);
    expect(store.keys().size).toBe(0);
  });

  it("rehydrates a persisted array on construction", () => {
    const memento = new FakeMemento({
      [HIDDEN_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix", "claudeteam-alpha:maya"],
    });
    const store = new HiddenMembersStore(memento);
    expect([...store.keys()].sort()).toEqual([
      "claudeteam-alpha:felix",
      "claudeteam-alpha:maya",
    ]);
  });

  it("defensively drops corrupt entries on rehydrate (non-string / no separator)", () => {
    const memento = new FakeMemento({
      [HIDDEN_MEMBERS_STORE_KEY]: [
        "claudeteam-alpha:felix",
        42,
        null,
        "no-separator",
        { x: 1 },
      ],
    });
    const store = new HiddenMembersStore(memento);
    expect(store.toArray()).toEqual(["claudeteam-alpha:felix"]);
  });

  it("tolerates a non-array persisted value (treats as empty)", () => {
    const memento = new FakeMemento({
      [HIDDEN_MEMBERS_STORE_KEY]: "not-an-array",
    });
    const store = new HiddenMembersStore(memento);
    expect(store.toArray()).toEqual([]);
  });
});

describe("HiddenMembersStore — mutators (the ONLY mutation surface)", () => {
  it("hide adds the (teamId, memberId) key and persists", async () => {
    const memento = new FakeMemento();
    const store = new HiddenMembersStore(memento);

    await store.hide("claudeteam-alpha", "felix");

    expect(store.keys().has("claudeteam-alpha:felix")).toBe(true);
    expect(memento.raw(HIDDEN_MEMBERS_STORE_KEY)).toEqual([
      "claudeteam-alpha:felix",
    ]);
  });

  it("hide is idempotent", async () => {
    const store = new HiddenMembersStore(new FakeMemento());
    await store.hide("claudeteam-alpha", "felix");
    await store.hide("claudeteam-alpha", "felix");
    expect(store.toArray()).toEqual(["claudeteam-alpha:felix"]);
  });

  it("show removes a key and persists", async () => {
    const memento = new FakeMemento({
      [HIDDEN_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix", "claudeteam-alpha:maya"],
    });
    const store = new HiddenMembersStore(memento);

    await store.show("claudeteam-alpha", "felix");

    expect(store.keys().has("claudeteam-alpha:felix")).toBe(false);
    expect(store.toArray()).toEqual(["claudeteam-alpha:maya"]);
  });

  it("show is idempotent (showing a not-hidden member is a no-op)", async () => {
    const store = new HiddenMembersStore(new FakeMemento());
    await store.show("claudeteam-alpha", "ghost");
    expect(store.toArray()).toEqual([]);
  });

  it("showAll clears the entire set", async () => {
    const memento = new FakeMemento({
      [HIDDEN_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix", "claudeteam-alpha:maya"],
    });
    const store = new HiddenMembersStore(memento);

    await store.showAll();

    expect(store.toArray()).toEqual([]);
    expect(memento.raw(HIDDEN_MEMBERS_STORE_KEY)).toEqual([]);
  });

  it("toArray returns a fresh array each call (no aliasing of internal Set)", () => {
    const store = new HiddenMembersStore(
      new FakeMemento({
        [HIDDEN_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix"],
      }),
    );
    const a = store.toArray();
    const b = store.toArray();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("HiddenMembersStore — persistence across reload", () => {
  it("a new store over the same memento sees prior hides (survives reload)", async () => {
    const memento = new FakeMemento();
    const store1 = new HiddenMembersStore(memento);
    await store1.hide("claudeteam-alpha", "felix");

    // Simulate a window reload: a fresh store reading the same backing memento.
    const store2 = new HiddenMembersStore(memento);
    expect(store2.keys().has("claudeteam-alpha:felix")).toBe(true);
  });
});

describe("HiddenMembersStore — AC4 regression guard (no auto-hide)", () => {
  it("repeated keys() reads (tick-like loop) never grow the set", () => {
    const store = new HiddenMembersStore(
      new FakeMemento({
        [HIDDEN_MEMBERS_STORE_KEY]: ["claudeteam-alpha:felix"],
      }),
    );
    const sizeBefore = store.keys().size;
    // Simulate many poll ticks reading the set — there is no time-based path.
    for (let i = 0; i < 100; i++) {
      const snapshot = store.keys();
      expect(snapshot.size).toBe(sizeBefore);
    }
    expect(store.keys().size).toBe(sizeBefore);
  });

  it("exposes no method that adds by time/inactivity — only hide/show/showAll", () => {
    const store = new HiddenMembersStore(new FakeMemento());
    // The mutation surface is exactly three explicit, user-action methods.
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && typeof proto[n] === "function",
    );
    // Mutators that a caller can invoke to CHANGE the set:
    const mutators = methods.filter((m) =>
      ["hide", "show", "showAll"].includes(m),
    );
    expect(mutators.sort()).toEqual(["hide", "show", "showAll"]);
    // No "expire", "prune", "autoHide", "tick", or time-based mutator exists.
    for (const banned of ["expire", "prune", "autoHide", "tick", "sweep"]) {
      expect(methods).not.toContain(banned);
    }
  });
});
