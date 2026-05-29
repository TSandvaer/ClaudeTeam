/**
 * E-09 / EPIC 86ca11187 — end-to-end NO-AUTO-CULL regression guard.
 *
 * Bug class guarded: the sponsor REJECTED auto-hide / auto-remove (DECISIONS
 * §36; backlog E-06 AC4 / E-07 AC4). The hidden- and removed-member sets may be
 * mutated ONLY by explicit user actions (`ui:hide-member` / `ui:show-member` /
 * `ui:show-all-hidden` / `ui:remove-member`) and the yaml-gated reconcile (which
 * only SHRINKS the removed set). No code path may add a member to either set
 * based on time, inactivity, or tile state.
 *
 * The UNIT guards already prove the *filter* (`applyHideMembersFilter` /
 * `applyRemoveMembersFilter`) is a pure read and the *store*
 * (`HiddenMembersStore` / `RemovedMembersStore`) exposes no time/inactivity
 * mutator (banned-method assertions). Those catch the INSTANCE. This integration
 * test catches the CLASS: it wires the REAL stores into the REAL `runTick`
 * pipeline (reducer → hide-finished → hide-idle → hide-members → remove-members →
 * wire serialize) and drives MULTIPLE ticks with a rich mix of cull-eligible
 * tile states present — a running agent that goes IDLE (stale mtime) then
 * FINISHED, plus never-run `available` baseline tiles for the rest of the roster.
 * If any tick auto-populated either persisted set as a side effect of those
 * states, the size assertions below would fail.
 *
 * Layer 2 (fixture filesystem) per testing-strategy.md. Pure-fs, no VS Code API.
 *
 * Source: backlog `team/nora-pl/epic-86ca11187-backlog.md` E-06 AC4 / E-07 AC4;
 *         test plan `team/sage-qa/epic-86ca11187-test-plan.md` § S7.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utimesSync } from "node:fs";

import {
  appendFinishedToolResult,
  createTempRoot,
  subagentsDirPath,
  writeMetaJson,
  writeParentJsonl,
  writeRoster,
  writeSessionFile,
  writeSubagentJsonl,
} from "./helpers/tempdir.js";
import { join } from "node:path";

import { runTick } from "../../src/extension/watcher/watcherLoop.js";
import {
  HiddenMembersStore,
  type MementoLike as HiddenMementoLike,
} from "../../src/extension/state/hiddenMembersStore.js";
import {
  RemovedMembersStore,
  type MementoLike as RemovedMementoLike,
} from "../../src/extension/state/removedMembersStore.js";
import { isCollapsedPersonaGroup } from "../../src/shared/types.js";

// Mirror the watcherLoop integration test constants.
const ALIVE_PID = 2_000_020;
const SESSION = "aaaabbbb-0000-0000-0000-00000000cc01";
const CWD = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
const AGENT_FELIX = "agentfelix000020";
// toolUseId baked into meta-new-schema-persona.json — required for the parent
// JSONL tool_result to mark the felix agent finished on the later tick.
const FELIX_TOOL_USE_ID = "toolu_01SZsHqGceAQC4Loovg6ion1";

/**
 * Minimal in-memory `vscode.Memento` fake. Satisfies BOTH store MementoLike
 * shapes (identical structural subset). Persists across `runTick` calls so the
 * "across reloads" intent is honored — a fresh store constructed from the same
 * fake rehydrates the same contents.
 */
function makeMemento(): HiddenMementoLike & RemovedMementoLike {
  const backing = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue: T): T {
      return backing.has(key) ? (backing.get(key) as T) : defaultValue;
    },
    update(key: string, value: unknown): Thenable<void> {
      backing.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("E-09 no-auto-cull pipeline guard (EPIC 86ca11187)", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let hiddenStore: HiddenMembersStore;
  let removedStore: RemovedMembersStore;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");

    // One live session, one felix agent. The other roster members (maya, bram,
    // sage) never ran → they materialize as `available` baseline tiles. That
    // gives the tick a mix of: a detected felix tile + several available
    // baselines, all of which are cull-ELIGIBLE if an auto-hide path existed.
    writeSessionFile(root, { pid: ALIVE_PID, sessionId: SESSION, cwd: CWD });
    writeParentJsonl(root, CWD, SESSION, { title: "no-auto-cull-guard" });
    writeMetaJson(root, CWD, SESSION, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD, SESSION, AGENT_FELIX, "subagent-running.jsonl");

    const memento = makeMemento();
    hiddenStore = new HiddenMembersStore(memento);
    removedStore = new RemovedMembersStore(memento);
  });

  afterEach(() => cleanup());

  /** Make the felix subagent JSONL appear stale (older than IDLE_THRESHOLD_MS). */
  function ageFelixJsonlToIdle(): void {
    const jsonlPath = join(
      subagentsDirPath(root, CWD, SESSION),
      `agent-${AGENT_FELIX}.jsonl`,
    );
    // 5 minutes ago — well beyond the 60s idle threshold.
    const past = new Date(Date.now() - 5 * 60_000);
    utimesSync(jsonlPath, past, past);
  }

  it("hidden + removed sets stay EMPTY across multiple ticks with idle/finished/available tiles present", async () => {
    // Snapshot the live store each tick — exactly what `startWatcher`'s
    // getHiddenMemberKeys/getRemovedMemberKeys getters do in production. The
    // pure `runTick` helper consumes resolved sets, not getters.
    const tickOpts = () => ({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: hiddenStore.keys(),
      removedMemberKeys: removedStore.keys(),
    });

    // --- Tick 1: felix RUNNING (fresh mtime), maya/bram/sage AVAILABLE ---------
    const t1 = await runTick(tickOpts());
    expect(hiddenStore.keys().size).toBe(0);
    expect(removedStore.keys().size).toBe(0);
    expect(t1.hiddenMemberKeys ?? []).toEqual([]);
    expect(t1.removedMemberKeys ?? []).toEqual([]);

    // --- Tick 2: felix IDLE (stale mtime) -------------------------------------
    ageFelixJsonlToIdle();
    const t2 = await runTick(tickOpts());
    // An idle tile must NOT auto-feed the hidden/removed set.
    expect(hiddenStore.keys().size).toBe(0);
    expect(removedStore.keys().size).toBe(0);
    expect(t2.hiddenMemberKeys ?? []).toEqual([]);
    expect(t2.removedMemberKeys ?? []).toEqual([]);

    // --- Tick 3: felix FINISHED (parent tool_result) --------------------------
    appendFinishedToolResult(root, CWD, SESSION, FELIX_TOOL_USE_ID);
    const t3 = await runTick(tickOpts());
    // A finished tile must NOT auto-feed the hidden/removed set either.
    expect(hiddenStore.keys().size).toBe(0);
    expect(removedStore.keys().size).toBe(0);
    expect(t3.hiddenMemberKeys ?? []).toEqual([]);
    expect(t3.removedMemberKeys ?? []).toEqual([]);
  });

  it("with member-sets empty and hide-idle/hide-finished OFF, idle + finished + available tiles all REMAIN visible (whole-team default)", async () => {
    // felix finished; the rest available. hide-idle / hide-finished default OFF.
    appendFinishedToolResult(root, CWD, SESSION, FELIX_TOOL_USE_ID);
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: hiddenStore.keys(),
      removedMemberKeys: removedStore.keys(),
    });

    const entries = state.sessions[0]?.rosterTiles.get("claudeteam-alpha");
    expect(entries).toBeDefined();
    const states = entries!.map((e) =>
      isCollapsedPersonaGroup(e) ? "group" : e.state,
    );
    // felix is FINISHED and still present (not suppressed); maya + bram are
    // available baselines and present. Nothing was auto-culled.
    expect(states).toContain("finished");
    expect(states).toContain("available");
    const memberIds = entries!
      .filter((e) => !isCollapsedPersonaGroup(e))
      .map((e) => (e as { memberId: string }).memberId);
    expect(memberIds).toContain("felix");
    expect(memberIds).toContain("maya");
    expect(memberIds).toContain("bram");

    // And neither persisted set was touched.
    expect(hiddenStore.keys().size).toBe(0);
    expect(removedStore.keys().size).toBe(0);
  });

  it("explicit hide IS honored end-to-end (positive control — proves the empty-set assertions above aren't vacuous)", async () => {
    // Explicitly hide felix (the ONLY sanctioned mutation path).
    await hiddenStore.hide("claudeteam-alpha", "felix");
    expect(hiddenStore.keys().size).toBe(1);

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: hiddenStore.keys(),
      removedMemberKeys: removedStore.keys(),
    });

    // felix suppressed from the default tree; the persisted set carries it on
    // the wire so E-06b's reveal surface can offer un-hide.
    const entries = state.sessions[0]?.rosterTiles.get("claudeteam-alpha") ?? [];
    const memberIds = entries
      .filter((e) => !isCollapsedPersonaGroup(e))
      .map((e) => (e as { memberId: string }).memberId);
    expect(memberIds).not.toContain("felix");
    expect(state.hiddenMemberKeys ?? []).toContain(
      "claudeteam-alpha:felix",
    );
    // removed set still untouched — hide and remove are independent.
    expect(removedStore.keys().size).toBe(0);
  });
});
