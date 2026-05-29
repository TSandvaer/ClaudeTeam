/**
 * Integration tests for `readSessionMetadata` — the single-pass parent
 * JSONL scan introduced by 86c9zfmke (perf dedup of `readSessionTitle` +
 * `readFinishedToolUseIds`).
 *
 * The function itself is file-local in `src/extension/watcher/watcherLoop.ts`
 * (and mirrored in `src/cli/agentTree.ts`). We exercise it via the
 * production `runTick` driver — same surface every existing test uses for
 * the prior split functions, so any regression on title-extraction OR
 * finished-detection surfaces in this suite.
 *
 * Why a dedicated suite over reusing the existing `fixtureFs.test.ts`
 * AC2.* blocks: those run through a test-local `collectFromTempdir`
 * helper with its OWN parser copy. To verify the PRODUCTION dedup, the
 * driver must be `runTick` (which calls `readSessionMetadata`).
 *
 * Coverage matrix (one pass extracts both axes):
 *   1. Title present + no tool_result   → title surfaces, finishedIds empty
 *   2. No title + tool_result present   → title fallback, finishedIds populated
 *   3. Title present + tool_result present (mixed order) → both extracted
 *   4. Title appears AFTER tool_result in the file → still extracted
 *   5. Async-launched ack between title and a real completion → ack skipped
 *   6. Missing/unreadable parent JSONL → title null + finishedIds empty
 *      (defensive contract)
 *   7. Malformed JSON lines interleaved → skipped, valid lines still parsed
 *
 * Source: ClickUp 86c9zfmke; Bram triage `team/bram-research/86c9yteju-triage-2026-05-26.md`
 * § Segment 3 (the 5.2MB-parent-JSONL double-read finding).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTempRoot,
  writeSessionFile,
  writeMetaJson,
  writeSubagentJsonl,
  writeParentJsonl,
  writeRoster,
  appendAsyncLaunchedAck,
  appendFinishedToolResult,
} from "./helpers/tempdir.js";

import { runTick } from "../../src/extension/watcher/watcherLoop.js";
import { cwdToSlug } from "../../src/shared/slug.js";
import {
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
} from "../../src/shared/types.js";
import type { AgentTile, RosterTileEntry } from "../../src/shared/types.js";

const PID = 2_010_001;
const SESSION_ID = "aaaabbbb-0000-0000-0000-0000000fmke01";
const CWD = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
const AGENT_FELIX = "agentfelixfmke001";
// Matches `tests/fixtures/meta-new-schema-persona.json` (the persona fixture).
const TOOL_USE_ID = "toolu_01SZsHqGceAQC4Loovg6ion1";

function findTile(
  tiles: readonly RosterTileEntry[],
  memberId: string,
): AgentTile | undefined {
  for (const t of tiles) {
    if (isCollapsedPersonaGroup(t) || isMultiAgentPersonaTile(t)) {
      const inner = t.instances.find((i) => i.memberId === memberId);
      if (inner) return inner;
    } else if (t.memberId === memberId) {
      return t;
    }
  }
  return undefined;
}

describe("86c9zfmke: readSessionMetadata single-pass scan via runTick", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: PID, sessionId: SESSION_ID, cwd: CWD });
    writeMetaJson(root, CWD, SESSION_ID, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD, SESSION_ID, AGENT_FELIX, "subagent-running.jsonl");
  });

  afterEach(() => cleanup());

  it("title present + no tool_result → title surfaces, agent not finished", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, { title: "Felix's session title" });

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("Felix's session title");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felix = findTile(alphaTiles, "felix");
    expect(felix).toBeDefined();
    expect(felix!.state).not.toBe("finished");
  });

  it("no title + tool_result present → title fallback, agent finished", async () => {
    // No title line; one tool_result for the persona's toolUseId.
    writeParentJsonl(root, CWD, SESSION_ID, {
      finishedToolUseIds: [TOOL_USE_ID],
    });

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("(no title yet)");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felix = findTile(alphaTiles, "felix");
    expect(felix).toBeDefined();
    expect(felix!.state).toBe("finished");
  });

  it("title AND tool_result in same JSONL → both extracted in one pass", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "Mixed session",
      finishedToolUseIds: [TOOL_USE_ID],
    });

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("Mixed session");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felix = findTile(alphaTiles, "felix");
    expect(felix!.state).toBe("finished");
  });

  it("title appears AFTER tool_result in the file → still extracted", async () => {
    // Write tool_result first, append title afterwards. The old code-path
    // was two independent passes so order didn't matter; this test
    // pins that the fused pass still extracts both regardless of order.
    writeParentJsonl(root, CWD, SESSION_ID, {
      finishedToolUseIds: [TOOL_USE_ID],
    });
    // Append a title record after the tool_result.
    const slug = cwdToSlug(CWD);
    const jsonlPath = join(root, "projects", slug, `${SESSION_ID}.jsonl`);
    appendFileSync(
      jsonlPath,
      JSON.stringify({
        type: "ai-title",
        title: "Title-after-toolresult",
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
        uuid: "ai-title-late",
      }) + "\n",
      "utf8",
    );

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("Title-after-toolresult");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")!.state).toBe("finished");
  });

  it("async-launched ack between title and a real completion → ack skipped, completion respected", async () => {
    // 1. Title written first.
    writeParentJsonl(root, CWD, SESSION_ID, { title: "Obs9 dedup test" });
    // 2. Async-launched ack for the persona's toolUseId.
    appendAsyncLaunchedAck(root, CWD, SESSION_ID, TOOL_USE_ID, AGENT_FELIX);
    // 3. A real (foreground-shaped) tool_result for the same toolUseId.
    appendFinishedToolResult(root, CWD, SESSION_ID, TOOL_USE_ID);

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("Obs9 dedup test");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")!.state).toBe("finished");
  });

  it("missing parent JSONL → title fallback to (no title yet), agent not finished", async () => {
    // Intentionally do NOT write the parent JSONL. The agent's meta.json
    // and JSONL ARE present, so the agent exists — just no parent data.
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("(no title yet)");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felix = findTile(alphaTiles, "felix");
    expect(felix).toBeDefined();
    expect(felix!.state).not.toBe("finished");
  });

  it("malformed JSON lines interleaved with valid records → valid lines still parsed", async () => {
    // Build a parent JSONL with a malformed line between the title and
    // the tool_result. The fused scan must skip the malformed line and
    // still extract both axes.
    const slug = cwdToSlug(CWD);
    const jsonlPath = join(root, "projects", slug, `${SESSION_ID}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "ai-title",
        title: "Survives malformed",
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
        uuid: "ai-title-malformed-test",
      }),
      "this is not valid JSON {{{{",
      JSON.stringify({
        type: "user",
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
        uuid: "tool-result-malformed-test",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: TOOL_USE_ID, content: "<redacted>", is_error: false },
          ],
        },
      }),
      "", // empty line — should be skipped
      "{\"type\":\"user\",\"message\":\"truncated", // truncated line
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    const s = state.sessions[0]!;
    expect(s.title).toBe("Survives malformed");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")!.state).toBe("finished");
  });

  it("first non-empty title wins; later ai-title records do not override", async () => {
    // Two ai-title records — the original `readSessionTitle` returned on
    // first hit. The fused scan preserves the same `title === null`
    // short-circuit on subsequent ai-title lines.
    const slug = cwdToSlug(CWD);
    const jsonlPath = join(root, "projects", slug, `${SESSION_ID}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "ai-title",
        title: "First wins",
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
        uuid: "title-1",
      }),
      JSON.stringify({
        type: "ai-title",
        title: "Should be ignored",
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
        uuid: "title-2",
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });

    expect(state.sessions[0]!.title).toBe("First wins");
  });

  // -------------------------------------------------------------------------
  // 86ca03nww — custom-title + gitBranch extraction (PR #104 review NITs 1-4)
  // -------------------------------------------------------------------------

  it("single custom-title record → customTitle surfaces on SessionTree", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "ai-title",
      customTitles: ["claude team"],
    });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    const s = state.sessions[0]!;
    expect(s.customTitle).toBe("claude team");
    expect(s.title).toBe("ai-title"); // raw ai-title still on wire
  });

  it("multiple custom-title records → LAST one wins (sponsor renames sequence)", async () => {
    // NIT 1 from PR #104 review: records are scattered through the file; the
    // parser must converge on the latest rename. Implemented as last-write-
    // wins (equivalent to scan-backward-from-EOF-first-match).
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "ai-title",
      customTitles: ["first rename", "second rename", "final name"],
    });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    expect(state.sessions[0]!.customTitle).toBe("final name");
  });

  it("custom-title with both key orders (NIT 2) → JSON.parse handles either", async () => {
    // Live data on disk shows BOTH key orders in the same file:
    //   {"type":"custom-title","sessionId":"...","customTitle":"..."}
    //   {"type":"custom-title","customTitle":"...","sessionId":"..."}
    // The parser must use JSON.parse + named-field access, never regex on
    // key sequence.
    const slug = cwdToSlug(CWD);
    const jsonlPath = join(root, "projects", slug, `${SESSION_ID}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "custom-title",
        sessionId: SESSION_ID,
        customTitle: "order A",
      }),
      JSON.stringify({
        type: "custom-title",
        customTitle: "order B",
        sessionId: SESSION_ID,
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    // Last-write-wins regardless of key order in either record.
    expect(state.sessions[0]!.customTitle).toBe("order B");
  });

  it("whitespace-only customTitle → normalized to undefined (resolver fall-through)", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "ai-title",
      customTitles: ["   ", "\t\t"],
    });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    const s = state.sessions[0]!;
    expect(s.customTitle).toBeUndefined();
  });

  it("attachment record with gitBranch → field surfaces on SessionTree", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "ai-title",
      gitBranch: "felix/86ca03nww-session-label-gitbranch",
    });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    expect(state.sessions[0]!.gitBranch).toBe(
      "felix/86ca03nww-session-label-gitbranch",
    );
  });

  it("gitBranch on multiple record types (NIT 4) → all accepted, last wins", async () => {
    // NIT 4 from PR #104 review: gitBranch is a top-level field on
    // attachment, user, assistant, AND system records — not attachment-only
    // (verified against 07e66f5e ClaudeTeam JSONL — 620 records carrying
    // the field across the four types). The parser walks forward; last
    // occurrence wins.
    const slug = cwdToSlug(CWD);
    const jsonlPath = join(root, "projects", slug, `${SESSION_ID}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "attachment",
        gitBranch: "main",
        sessionId: SESSION_ID,
        uuid: "attach-1",
      }),
      JSON.stringify({
        type: "user",
        gitBranch: "felix/wip",
        sessionId: SESSION_ID,
        uuid: "user-1",
        message: { role: "user", content: [] },
      }),
      JSON.stringify({
        type: "assistant",
        gitBranch: "felix/wip",
        sessionId: SESSION_ID,
        uuid: "asst-1",
        message: { role: "assistant", content: [] },
      }),
      JSON.stringify({
        type: "system",
        gitBranch: "felix/final-branch",
        sessionId: SESSION_ID,
        uuid: "sys-1",
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf8");
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    expect(state.sessions[0]!.gitBranch).toBe("felix/final-branch");
  });

  it("no custom-title and no gitBranch records → both fields omitted (back-compat)", async () => {
    writeParentJsonl(root, CWD, SESSION_ID, { title: "Just ai-title" });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    const s = state.sessions[0]!;
    expect(s.title).toBe("Just ai-title");
    // Both label-surface fields should be undefined (parser found nothing)
    // AND the SessionTree should omit them entirely per the back-compat wire
    // shape contract.
    expect(s.customTitle).toBeUndefined();
    expect(s.gitBranch).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(s, "customTitle")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s, "gitBranch")).toBe(false);
  });

  it("missing parent JSONL → customTitle + gitBranch both undefined", async () => {
    // The parser's defensive contract: read error → both fields undefined.
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    const s = state.sessions[0]!;
    expect(s.customTitle).toBeUndefined();
    expect(s.gitBranch).toBeUndefined();
  });

  it("all three label surfaces present + tool_result → one pass extracts everything", async () => {
    // Coverage: customTitle, ai-title, gitBranch, AND a finished tool_result
    // — all in one parent JSONL. Proves the fused scan extracts every axis
    // in a single read+iteration.
    writeParentJsonl(root, CWD, SESSION_ID, {
      title: "AI title",
      customTitles: ["sponsor renamed it"],
      gitBranch: "felix/feature-x",
      finishedToolUseIds: [TOOL_USE_ID],
    });
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      showAllSessionsGlobally: true,
    });
    const s = state.sessions[0]!;
    expect(s.title).toBe("AI title");
    expect(s.customTitle).toBe("sponsor renamed it");
    expect(s.gitBranch).toBe("felix/feature-x");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")!.state).toBe("finished");
  });
});
