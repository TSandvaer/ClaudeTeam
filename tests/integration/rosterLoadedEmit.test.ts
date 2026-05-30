/**
 * Integration tests for 86ca1tv41 — the watcher emits `roster:loaded` so the
 * Manage Team panel reaches its EDIT layout instead of being stuck on the setup
 * wizard.
 *
 * Root cause (confirmed): before this fix no host code path posted
 * `roster:loaded`, so the webview's `manageConfig` was permanently null →
 * `renderManageTeamPanel` always rendered the wizard (config === null branch).
 * The fix stamps the loaded roster onto the produced `DashboardState`
 * (`state.roster`) and fires a new `onRosterLoaded(teams)` watcher callback on
 * every emitting tick (same hash-skip as `onStateChange`). Production wires that
 * callback to `postRosterLoaded(webview, teams)`.
 *
 * These tests exercise the DATA PLANE: the watcher fires `onRosterLoaded` with
 * the loaded roster verbatim, gated correctly by the hash-skip, and re-fires on
 * a roster change. The webview state-machine assertion (config !== null → edit
 * layout) lives in tests/unit/webview/manageTeamLayout.test.ts.
 *
 * Source: src/extension/watcher/watcherLoop.ts (onRosterLoaded, state.roster)
 *         src/extension/messageBus.ts (postRosterLoaded)
 */

import { writeFileSync } from "node:fs";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTempRoot,
  writeRoster,
} from "./helpers/tempdir.js";

import {
  startWatcher,
  runTick,
  type WatcherHandle,
} from "../../src/extension/watcher/watcherLoop.js";
import type { DashboardState, Team } from "../../src/shared/types.js";

const SLOW_POLL_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

describe("86ca1tv41 — runTick stamps state.roster", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
  });

  afterEach(() => cleanup());

  it("carries the loaded roster verbatim on the produced DashboardState", async () => {
    const rosterPath = writeRoster(root, "teams-valid.yaml");
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    expect(state.roster).toBeDefined();
    // teams-valid.yaml declares two teams: claudeteam-alpha + claudeteam-beta.
    expect(state.roster!.map((t) => t.id)).toEqual([
      "claudeteam-alpha",
      "claudeteam-beta",
    ]);
    // The alpha team's members carry the edit-layout fields the panel needs
    // (display / role / color / match) — verbatim from the loader.
    const alpha = state.roster!.find((t) => t.id === "claudeteam-alpha")!;
    const felix = alpha.members.find((m) => m.id === "felix")!;
    expect(felix.display).toBe("Felix");
    expect(felix.role).toBe("Extension Host Dev");
    expect(felix.color).toBe("#5d8aa8");
    expect(felix.match.length).toBeGreaterThan(0);
  });

  it("roster is an empty array when no roster path is supplied", async () => {
    const state = await runTick({
      claudeHome: root,
    });
    expect(state.roster).toEqual([]);
  });
});

describe("86ca1tv41 — onRosterLoaded callback fires with the loaded roster", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let handle: WatcherHandle | null = null;
  let rosterEmissions: Team[][];
  let stateEmissions: DashboardState[];

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    rosterEmissions = [];
    stateEmissions = [];
    handle = null;
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    cleanup();
  });

  it("fires onRosterLoaded alongside onStateChange on the first tick", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => stateEmissions.push(s),
      onRosterLoaded: (teams) => rosterEmissions.push(teams),
    });

    expect(await waitFor(() => rosterEmissions.length >= 1, 1500)).toBe(true);
    // Paired: every state emit carries a roster emit (panel + dashboard stay in
    // sync). The first emission carries the non-empty roster → webview sets
    // manageConfig → edit layout reachable.
    expect(stateEmissions.length).toBe(rosterEmissions.length);
    expect(rosterEmissions[0]!.map((t) => t.id)).toEqual([
      "claudeteam-alpha",
      "claudeteam-beta",
    ]);
  });

  it("does NOT fire onRosterLoaded on a hash-skipped tick (no roster change)", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => stateEmissions.push(s),
      onRosterLoaded: (teams) => rosterEmissions.push(teams),
    });

    expect(await waitFor(() => rosterEmissions.length >= 1, 1500)).toBe(true);
    const baseline = rosterEmissions.length;

    // triggerTick with no filesystem change → hash-skip → neither callback fires.
    handle.triggerTick();
    handle.triggerTick();
    await sleep(400);

    expect(rosterEmissions.length).toBe(baseline);
  });

  it("re-fires onRosterLoaded with the updated roster after a YAML edit", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => stateEmissions.push(s),
      onRosterLoaded: (teams) => rosterEmissions.push(teams),
    });

    expect(await waitFor(() => rosterEmissions.length >= 1, 1500)).toBe(true);
    const baseline = rosterEmissions.length;

    // Edit the roster (drop the beta team) and trigger a tick. The roster is
    // part of hashState, so the changed roster re-emits even though no agent /
    // session changed. Written inline (hermetic — no extra fixture file).
    writeFileSync(
      rosterPath,
      [
        "teams:",
        "  - id: claudeteam-alpha",
        '    name: "ClaudeTeam Alpha"',
        "    members:",
        "      - id: felix",
        '        display: "Felix"',
        '        role: "Extension Host Dev"',
        "        match:",
        '          - agentType_equals: "felix"',
        "",
      ].join("\n"),
      "utf8",
    );
    handle.triggerTick();

    expect(
      await waitFor(() => rosterEmissions.length > baseline, 1500),
    ).toBe(true);
    const latest = rosterEmissions[rosterEmissions.length - 1]!;
    expect(latest.map((t) => t.id)).toEqual(["claudeteam-alpha"]);
  });
});
