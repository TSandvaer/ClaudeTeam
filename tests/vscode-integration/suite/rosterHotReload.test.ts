/**
 * Layer-3 YAML hot-reload smoke test (M3-09 AC1).
 *
 * Drives the M3-01 production code path end-to-end inside a real spawned
 * VS Code instance:
 *
 *   tempdir teams.yaml  →  runTick({globalRosterPath, ...})
 *     →  loadRoster reads YAML  →  matcher routes the seeded subagent
 *     →  DashboardState.sessions[].rosterTiles[teamId] contains the
 *        matched member id
 *   mutate teams.yaml (rename the member id)
 *     →  runTick again
 *     →  DashboardState.rosterTiles[teamId] now contains the NEW member id
 *     →  the OLD member id is gone (reducer doesn't leak prior tiles)
 *
 * The test does NOT spin up `startRosterWatcher` — that surface is covered
 * by the Layer-2 polling-fallback suite at
 * `tests/integration/rosterWatcher.test.ts`. Layer-3 instead exercises
 * the loader → matcher → reducer composition under VS Code's real
 * Electron runtime (catches bundling / Node-version / require-resolution
 * regressions that Layer-2 cannot).
 *
 * What this catches that Layer-1/2 doesn't:
 *   - `tsc -p tsconfig.vscode-integration.json` compiles the host-side
 *     modules into CJS that loads correctly under Node 22+ require()
 *     from inside the Electron extension host.
 *   - `loadRoster` + `buildAgentTree` + `filterSessionsToWindow` compose
 *     correctly when invoked from a real VS Code session (vs the vitest
 *     test environment, which can paper over module-resolution issues
 *     with on-the-fly TS transpilation).
 *   - The `state.sessions[].rosterTiles` Map shape survives across two
 *     ticks with the SAME team key but a DIFFERENT member id — i.e. the
 *     reducer REPLACES tiles on each tick rather than leaking them
 *     forward (a known reducer-side bug class, parallel to the
 *     subscription-leak fix in M2-06 AC7(e)).
 *
 * Pass criteria (per M3-09 AC1):
 *   - BEFORE mutation: rosterTiles for the test team contains the ORIGINAL
 *     member id ("alice").
 *   - AFTER mutation: rosterTiles for the test team contains the NEW
 *     member id ("bob"); the original is absent.
 *   - `filterApplied === false` in both ticks (no workspaceFolders
 *     supplied → don't-strand-the-user passthrough).
 *
 * Negative-path coverage (per test-plan negative-path requirement):
 *   - BEFORE test asserts "bob" is ABSENT — a test that only asserted
 *     "alice" present would silently pass against a reducer that always
 *     emitted both members regardless of YAML `match` rules.
 *   - AFTER test asserts "alice" is ABSENT — a test that only asserted
 *     "bob" present would silently pass against a leaky reducer that
 *     accumulated tiles across ticks instead of replacing them.
 *
 * Webview-DOM limitation (mirrors `webviewSmoke.test.ts` header):
 *   VS Code's Extension API does NOT expose the webview iframe DOM from
 *   the host process. The AC text "presence-check on a roster member id
 *   in the webview HTML" translates at this layer to: presence of the
 *   member id in the `DashboardState` shape `postState(webview, state)`
 *   serializes onto the wire. Wire-shape serialization is covered by
 *   Layer-1 unit tests (`tests/unit/messageBus.test.ts`); the render of
 *   the wire shape into tile DOM is covered by Layer-1 jsdom unit tests
 *   (`tests/unit/webview/dashboardTile.test.ts`). The host-observable
 *   proxy at Layer-3 is the production state shape itself.
 *
 * Source: src/extension/watcher/watcherLoop.ts runTick
 *         src/extension/roster/loader.ts loadRoster
 *         src/extension/roster/rosterWatcher.ts startRosterWatcher (M3-01)
 *         team/nora-pl/milestone-3-backlog.md §M3-09 AC1
 *         .claude/docs/testing-strategy.md "Layer 3 — VS Code integration"
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { runTick } from "../../../src/extension/watcher/watcherLoop.js";
import { cwdToSlug } from "../../../src/shared/slug.js";

const EXTENSION_ID = "claudeteam.claudeteam";

// ---------------------------------------------------------------------------
// Fixture YAML — two roster shapes, same team id, different single member.
// Mutation simulates the user editing the file in VS Code's editor.
// ---------------------------------------------------------------------------

const ROSTER_INITIAL = `teams:
  - id: hot-reload-team
    name: "Hot-reload Team"
    members:
      - id: alice
        display: "Alice"
        role: "Pre-mutation Member"
        match:
          - agentType_equals: "hotreload-alice"
`;

const ROSTER_MUTATED = `teams:
  - id: hot-reload-team
    name: "Hot-reload Team"
    members:
      - id: bob
        display: "Bob"
        role: "Post-mutation Member"
        match:
          - agentType_equals: "hotreload-bob"
`;

// Two meta.json shapes — one matches each roster variant by agentType.
// Both subagents are on disk for both ticks; only one matches at a time
// because the roster's matcher only fires on the agentType_equals rule
// that the YAML currently defines.
const META_ALICE = JSON.stringify({
  agentType: "hotreload-alice",
  description: "Hot-reload Alice fixture",
  toolUseId: "toolu_HOTRELOAD_ALICE",
});
const META_BOB = JSON.stringify({
  agentType: "hotreload-bob",
  description: "Hot-reload Bob fixture",
  toolUseId: "toolu_HOTRELOAD_BOB",
});

suite("M3-09 AC1 — YAML hot-reload smoke (Layer-3)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let rosterPath: string;
  let sessionCwd: string;

  // Seed a single live session + its subagents under tempRoot. Inlined
  // (no shared helper) because the integration tsc rootDir does NOT
  // include tests/integration/helpers, and adding it would couple two
  // unrelated test trees.
  function seedFixtures(): void {
    const sessionId = "11111111-1111-1111-1111-111111111111";
    const pid = 3_141_592;

    // §1 — session file at <claudeHome>/sessions/{pid}.json
    const sessionsDir = path.join(claudeHome, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId,
        cwd: sessionCwd,
        version: "2.1.145",
        entrypoint: "claude-vscode",
        startedAt: Date.now(),
        procStart: "639151272847822440",
        peerProtocol: 1,
        kind: "interactive",
      }),
      "utf8",
    );

    // §2/§3/§4 — projects/<slug>/<sessionId>/subagents/*
    const slug = cwdToSlug(sessionCwd);
    const subagentsDir = path.join(
      claudeHome,
      "projects",
      slug,
      sessionId,
      "subagents",
    );
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(subagentsDir, "agent-hotreloadalice0001.meta.json"),
      META_ALICE,
      "utf8",
    );
    fs.writeFileSync(
      path.join(subagentsDir, "agent-hotreloadalice0001.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId,
        timestamp: new Date().toISOString(),
        uuid: "user-alice-001",
      }) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(subagentsDir, "agent-hotreloadbob000002.meta.json"),
      META_BOB,
      "utf8",
    );
    fs.writeFileSync(
      path.join(subagentsDir, "agent-hotreloadbob000002.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId,
        timestamp: new Date().toISOString(),
        uuid: "user-bob-001",
      }) + "\n",
      "utf8",
    );

    // §2 — parent JSONL with an ai-title (cosmetic — reducer reports
    // "(no title yet)" without it, which is fine; seeding makes the
    // fixture closer to real captures).
    const parentJsonl = path.join(
      claudeHome,
      "projects",
      slug,
      `${sessionId}.jsonl`,
    );
    fs.writeFileSync(
      parentJsonl,
      JSON.stringify({
        type: "ai-title",
        title: "M3-09 hot-reload fixture",
        sessionId,
        timestamp: new Date().toISOString(),
        uuid: "ai-title-hotreload",
      }) + "\n",
      "utf8",
    );
  }

  suiteSetup(async () => {
    // Confirm the extension activated — Layer-3 tests run inside the same
    // VS Code instance, so this is mostly a sanity check on the test
    // harness wiring (the other Layer-3 suites also do this).
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ct-m3-09-hotreload-"));
    claudeHome = path.join(tempRoot, "claude");
    fs.mkdirSync(claudeHome, { recursive: true });

    // Use a Windows-style cwd on Windows and POSIX otherwise so cwdToSlug
    // sees a realistic input on each runtime (the slug rule branches on
    // drive-letter presence). The session cwd never points at a real
    // directory in this test — only the slug-derivation path matters for
    // the projects/<slug>/ lookup under tempRoot.
    sessionCwd =
      process.platform === "win32"
        ? "c:\\Trunk\\PRIVATE\\M309HotReload"
        : "/tmp/m309-hot-reload";

    // Roster at tempRoot/claudeteam/teams.yaml — mirrors the production
    // ~/.claudeteam/teams.yaml location (separate from ~/.claude/).
    const rosterDir = path.join(tempRoot, "claudeteam");
    fs.mkdirSync(rosterDir, { recursive: true });
    rosterPath = path.join(rosterDir, "teams.yaml");
    fs.writeFileSync(rosterPath, ROSTER_INITIAL, "utf8");

    seedFixtures();
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test("BEFORE mutation: rosterTiles contains the ORIGINAL member id 'alice'", async () => {
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      // No projectRosterPath — tests the global-only path.
      // No workspaceFolders — don't-strand-the-user passthrough so the
      // filter doesn't drop our seeded session.
      logger: { warn: () => {} },
    });

    assert.strictEqual(
      state.sessions.length,
      1,
      `Expected exactly 1 seeded session; got ${state.sessions.length}. ` +
        `Verify <claudeHome>/sessions/ contains the single PID file written ` +
        `by seedFixtures and that filterSessionsToWindow's no-folders ` +
        `passthrough did not eat it.`,
    );
    const session = state.sessions[0]!;
    const teamTiles = session.rosterTiles.get("hot-reload-team");
    assert.ok(
      teamTiles,
      `Expected rosterTiles to contain team "hot-reload-team"; got ` +
        `teamOrder=${JSON.stringify(session.teamOrder)}. The matcher may have ` +
        `failed to route agentType="hotreload-alice" against the ` +
        `agentType_equals rule.`,
    );
    const memberIds = teamTiles.map((t) => t.memberId);
    assert.ok(
      memberIds.includes("alice"),
      `Expected pre-mutation rosterTiles to contain "alice"; got ` +
        `${JSON.stringify(memberIds)}. If "bob" appears here, suiteSetup or ` +
        `a prior test wrote the post-mutation roster into rosterPath.`,
    );
    // NEGATIVE-PATH PAIR: bob must NOT appear pre-mutation. A test that
    // only asserted alice's presence would silently pass against a reducer
    // that emitted BOTH members regardless of the YAML `match` rules.
    assert.ok(
      !memberIds.includes("bob"),
      `Pre-mutation rosterTiles unexpectedly contains "bob". The matcher ` +
        `should not have matched agentType="hotreload-bob" against the ` +
        `initial roster (which only defines a rule for "hotreload-alice").`,
    );
  });

  test("AFTER mutation: rosterTiles contains NEW id 'bob', NOT the original", async () => {
    // Mutate the roster YAML — same path the production rosterWatcher
    // would observe via FileSystemWatcher in a live session. We don't
    // wait for the watcher's debounce here because we call runTick
    // directly; the watcher is a debouncer + tick-trigger around the
    // same loadRoster call.
    fs.writeFileSync(rosterPath, ROSTER_MUTATED, "utf8");

    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      logger: { warn: () => {} },
    });

    assert.strictEqual(
      state.sessions.length,
      1,
      `Session count should remain 1 across the roster mutation; got ` +
        `${state.sessions.length}. Roster changes must not affect session ` +
        `discovery.`,
    );
    const session = state.sessions[0]!;
    const teamTiles = session.rosterTiles.get("hot-reload-team");
    assert.ok(
      teamTiles,
      `Expected post-mutation rosterTiles to still contain team ` +
        `"hot-reload-team" (team id unchanged across the mutation); got ` +
        `teamOrder=${JSON.stringify(session.teamOrder)}.`,
    );
    const memberIds = teamTiles.map((t) => t.memberId);
    assert.ok(
      memberIds.includes("bob"),
      `Expected post-mutation rosterTiles to contain "bob"; got ` +
        `${JSON.stringify(memberIds)}. The matcher may have failed to pick ` +
        `up the YAML mutation, OR loadRoster cached the pre-mutation roster ` +
        `(loadRoster MUST re-read disk on every call).`,
    );
    // NEGATIVE-PATH (bug class: leaky reducer). alice must be gone. If the
    // reducer's rosterTiles map merged the new tick's tiles INTO the prior
    // tick's tiles instead of REPLACING, both members would appear here.
    // That's a real bug class — parallel to the subscription-leak fix in
    // M2-06 AC7(e); the reducer-side analog of it.
    assert.ok(
      !memberIds.includes("alice"),
      `Post-mutation rosterTiles still contains "alice" — the reducer is ` +
        `likely leaking pre-mutation tiles into the new tick (bug class: ` +
        `"rosterTiles list accumulates instead of replacing"). The mutated ` +
        `YAML defines NO rule for agentType="hotreload-alice", so alice ` +
        `should fall out of the rostered set.`,
    );
  });

  test("filterApplied is false on the don't-strand passthrough path", async () => {
    // M3-03 contract: when workspaceFolders is undefined / empty, the
    // window filter passes through and filterApplied is false. This
    // assertion documents the test's filter-mode so the AC1 rosterTiles
    // assertions are interpreted correctly (no sessions dropped by a
    // stray filter).
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      logger: { warn: () => {} },
    });
    assert.strictEqual(
      state.filterApplied === true,
      false,
      `Expected filterApplied to be false / undefined in the don't-strand ` +
        `passthrough; got ${state.filterApplied}. If true, AC2's window-filter ` +
        `surface accidentally engaged here.`,
    );
  });
});
