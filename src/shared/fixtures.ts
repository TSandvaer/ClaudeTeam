/**
 * Static fixture AgentTree for static-fixture mode (M2-05 AC8 + AC9).
 *
 * Used by:
 *   1. The webview when `acquireVsCodeApi` is unavailable (plain browser dev mode),
 *      so Maya can iterate on tile layout without a live VS Code host.
 *   2. Component tests that need a realistic state shape without rebuilding the
 *      reducer's full input plumbing.
 *
 * Covers (per M2-05 AC8):
 *   - All six ClaudeTeam personas (felix, maya, iris, nora, sage, bram).
 *   - All four AgentStates (running, idle, finished, error).
 *   - At least one background agent (collapsed chip) and a dead session.
 *
 * Field names mirror Iris's M1-03 §6 Glossary verbatim (display / role / activity
 * / model / state) — these are inherited unchanged in the M2-03 dashboard spec.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §12 done-when assertions
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC8/AC9
 */

import type { AgentTile, AgentTree, SessionTree } from "./types.js";

// Team ids used by the fixture roster. Match teams-valid.yaml at fixture-time.
const TEAM_CLAUDETEAM_ALPHA = "claudeteam-alpha";

/**
 * Six fully-populated tiles, one per persona, exercising every AgentState.
 * Stable order so screenshot diffs are deterministic across reloads.
 */
const FIXTURE_TILES: AgentTile[] = [
  {
    memberId: "felix",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Felix",
    role: "Extension Host Dev",
    activity: "tool:Edit src/extension/watcher/watcherLoop.ts",
    model: "claude-opus-4-7",
    state: "running",
    agentId: "a1d53b4a2db17f2f5",
    toolUseId: "toolu_01SZsHqGceAQC4Loovg6ion1",
    // 86c9zqa75 — exercise the member-color paint in browser dev mode + tests.
    // Slate blue; pairs with Maya's green below so the dev render visually
    // demonstrates the spec §2.2 "Felix-the-blue-dot / Maya-the-green-dot"
    // identification-at-a-glance affordance.
    memberColor: "#5d8aa8",
  },
  {
    memberId: "maya",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Maya",
    role: "Webview UI Dev",
    activity: "idle 14s",
    model: "claude-opus-4-7",
    state: "idle",
    agentId: "b94a73c4a44e1f8b2",
    toolUseId: "toolu_02MAyzNqsBcaR9Lpoxh7jpn2",
  },
  {
    memberId: "iris",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Iris",
    role: "UX Spec Author",
    activity: "finished",
    model: "claude-sonnet-4-5",
    state: "finished",
    agentId: "c2db5e8b91f3a02c7",
    toolUseId: "toolu_03IRyzPqfCdbS0LqnaJ7kqo3",
  },
  {
    memberId: "nora",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Nora",
    role: "Planner",
    activity: "tool:Read team/nora-pl/milestone-2-backlog.md",
    model: "claude-opus-4-7",
    state: "running",
    agentId: "d83fc2ec1b4a82e93",
    toolUseId: "toolu_04NOSyTqrDecT1MrlbK8lrp4",
    // 86c9zqa75 — sage-green; pairs with Felix's slate-blue for the dev
    // render's two-distinct-running-dots demonstration. Material palette
    // mid-saturation per roster-matching.md theme-contrast suggestion.
    memberColor: "#9caf88",
  },
  {
    memberId: "sage",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Sage",
    role: "QA / Tester",
    // Activity surface for a parse-error rostered tile (browser-dev only —
    // production routes parse-failed metas to background per reducer.ts).
    // Format matches `formatMetaParseError` output verbatim (NIT #2 in M3-04
    // follow-up); model surfaces the NIT-#1 fallback placeholder so dev mode
    // shows the same string production would when the JSONL has no resolved
    // model alongside an invalid meta.json.
    activity: "error: meta.json parse failed: missing field 'agentType'",
    model: "model:unknown",
    state: "error",
    agentId: "e94fd5fa2c5b934a4",
    toolUseId: null,
  },
  {
    memberId: "bram",
    teamId: TEAM_CLAUDETEAM_ALPHA,
    display: "Bram",
    role: "Internals Consultant",
    activity: "idle 47s",
    model: "claude-sonnet-4-5",
    state: "idle",
    agentId: "f15e0e3b3d6c045b5",
    toolUseId: "toolu_06BRSyVqtFefV3OtndL0nrr6",
  },
];

/** Primary session — alive, all six personas rostered, three background agents. */
const FIXTURE_PRIMARY_SESSION: SessionTree = {
  shortId: "7b53d0ee",
  sessionId: "7b53d0ee-da11-4c38-9899-a9c24b754b93",
  pid: 68644,
  entrypoint: "claude-vscode",
  version: "2.1.145",
  isAlive: true,
  cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
  title: "ClaudeTeam M2-05 webview build",
  rosterTiles: new Map([[TEAM_CLAUDETEAM_ALPHA, FIXTURE_TILES]]),
  teamOrder: [TEAM_CLAUDETEAM_ALPHA],
  background: [
    {
      agentType: "general-purpose",
      description: "Agent A — data sources investigation",
      state: "running",
      model: "claude-sonnet-4-5",
    },
    {
      agentType: "Explore",
      description: "Map MARIAN-TUTOR orchestration",
      state: "running",
      model: "claude-sonnet-4-5",
    },
    {
      agentType: "general-purpose",
      description: "Agent B — limitations & edge cases",
      state: "finished",
      model: "claude-sonnet-4-5",
    },
  ],
};

/**
 * Secondary session — dead PID, no tiles render (per spec §4 dead-session
 * treatment). Header still renders so the sponsor sees the session existed.
 */
const FIXTURE_DEAD_SESSION: SessionTree = {
  shortId: "a91f3c20",
  sessionId: "a91f3c20-fa20-4e29-b777-d7e85b32a811",
  pid: 99999,
  entrypoint: "claude-vscode",
  version: "2.1.145",
  isAlive: false,
  cwd: "c:\\Trunk\\PRIVATE\\Axelot-tutor",
  title: "Axelot tutor — earlier session",
  rosterTiles: new Map(),
  teamOrder: [],
  background: [],
};

/**
 * Fixture state used by the webview when running outside VS Code (browser dev)
 * AND by component tests that need a realistic AgentTree without spinning the
 * reducer. Order is deterministic for screenshot stability.
 */
export const FIXTURE_STATE: AgentTree = {
  sessions: [FIXTURE_PRIMARY_SESSION, FIXTURE_DEAD_SESSION],
};

/**
 * Empty-state fixture — exercises §3.2 "No live Claude Code sessions" rendering.
 * Used by the empty-state test in dashboardTile.test.ts.
 */
export const FIXTURE_EMPTY_STATE: AgentTree = {
  sessions: [],
};
