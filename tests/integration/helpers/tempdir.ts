/**
 * Tempdir helper for M1-10 integration tests.
 *
 * Builds a temporary directory that mimics the ~/.claude/ filesystem layout
 * so integration tests can point sessionRegistry / subagentTailer /
 * metaJsonLoader at a controlled tree without touching the real ~/.claude/.
 *
 * Layout mirrors data-sources.md §1–§4 exactly:
 *
 *   <root>/
 *     sessions/
 *       {pid}.json                          §1 live process registry
 *     projects/
 *       {slug}/
 *         {sessionId}.jsonl                 §2 parent session transcript
 *         {sessionId}/
 *           subagents/
 *             agent-{agentId}.meta.json     §4 subagent metadata
 *             agent-{agentId}.jsonl         §3 subagent transcript
 *
 * AC1 (M1-10): tempdir replicates the exact ~/.claude/ structure.
 * AC3 (M1-10): fixtures are loaded from tests/fixtures/ — no content is
 *   synthesized inside this file. If a fixture is missing, loadFixture()
 *   fails with a clear message naming the missing file.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { cwdToSlug } from "../../../src/shared/slug.js";

// Re-export so existing imports `from "./helpers/tempdir.js"` keep working.
export { cwdToSlug };

// ---------------------------------------------------------------------------
// Fixture resolution
// ---------------------------------------------------------------------------

/**
 * Absolute path to the tests/fixtures/ directory.
 * Integration tests MUST NOT synthesize fixture content — load from here.
 */
export const FIXTURES_DIR = fileURLToPath(
  new URL("../../fixtures", import.meta.url),
);

/**
 * Read a fixture file synchronously.
 * AC3: fails with a clear "required from M1-02 not found" message if missing.
 */
export function loadFixture(name: string): string {
  const path = join(FIXTURES_DIR, name);
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `fixture ${name} required from M1-02 not found at ${path}: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tempdir root
// ---------------------------------------------------------------------------

/**
 * Create a fresh tempdir root and return its path + cleanup function.
 */
export function createTempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "claudeteam-integration-"));
  return {
    root,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup — do not fail the test on cleanup errors.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// §1 — session file builders (~/.claude/sessions/{pid}.json)
// ---------------------------------------------------------------------------

export interface SessionSpec {
  pid: number;
  sessionId: string;
  cwd: string;
  version?: string;
  entrypoint?: string;
  startedAt?: number;
}

/**
 * Write a {pid}.json session file into <root>/sessions/.
 * Returns the path written.
 */
export function writeSessionFile(root: string, spec: SessionSpec): string {
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${spec.pid}.json`);
  const record = {
    pid: spec.pid,
    sessionId: spec.sessionId,
    cwd: spec.cwd,
    version: spec.version ?? "2.1.145",
    entrypoint: spec.entrypoint ?? "claude-vscode",
    startedAt: spec.startedAt ?? Date.now(),
    procStart: "639151272847822440",
    peerProtocol: 1,
    kind: "interactive",
  };
  writeFileSync(filePath, JSON.stringify(record), "utf8");
  return filePath;
}

/**
 * Delete a session file — simulates session disappearing mid-test (AC2: session disappears).
 */
export function deleteSessionFile(root: string, pid: number): void {
  const filePath = join(root, "sessions", `${pid}.json`);
  unlinkSync(filePath);
}

// ---------------------------------------------------------------------------
// §3 + §4 — subagent directory helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the subagents/ directory for a session exists and return its path.
 */
export function subagentsDirPath(root: string, cwd: string, sessionId: string): string {
  const slug = cwdToSlug(cwd);
  const dir = join(root, "projects", slug, sessionId, "subagents");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a meta.json file for a subagent using the content of a fixture file.
 * AC3: content comes from tests/fixtures/, not synthesized here.
 *
 * @param fixtureName  filename under tests/fixtures/ (e.g. "meta-old-schema.json")
 * @returns path of the written file
 */
export function writeMetaJson(
  root: string,
  cwd: string,
  sessionId: string,
  agentId: string,
  fixtureName: string,
): string {
  const dir = subagentsDirPath(root, cwd, sessionId);
  const content = loadFixture(fixtureName);
  const filePath = join(dir, `agent-${agentId}.meta.json`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Write a subagent JSONL file using the content of a fixture file.
 *
 * @param fixtureName  filename under tests/fixtures/ (e.g. "subagent-running.jsonl")
 */
export function writeSubagentJsonl(
  root: string,
  cwd: string,
  sessionId: string,
  agentId: string,
  fixtureName: string,
): string {
  const dir = subagentsDirPath(root, cwd, sessionId);
  const content = loadFixture(fixtureName);
  const filePath = join(dir, `agent-${agentId}.jsonl`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// §2 — parent JSONL builders (~/.claude/projects/{slug}/{sessionId}.jsonl)
// ---------------------------------------------------------------------------

/**
 * Return the path to the parent {sessionId}.jsonl, creating the project
 * directory if needed.
 */
export function parentJsonlPath(root: string, cwd: string, sessionId: string): string {
  const slug = cwdToSlug(cwd);
  const projectDir = join(root, "projects", slug);
  mkdirSync(projectDir, { recursive: true });
  return join(projectDir, `${sessionId}.jsonl`);
}

/**
 * Write a parent JSONL with an optional ai-title record and optional
 * tool_result records for finished subagents.
 *
 * Per data-sources.md §3 "JSONL closing semantics": the tool_result entry
 * with tool_use_id == meta.toolUseId is the ONLY reliable "finished" signal.
 *
 * @param opts.finishedToolUseIds  toolUseId values that should appear as
 *   closed tool_result entries in the parent (marks those subagents finished).
 */
export function writeParentJsonl(
  root: string,
  cwd: string,
  sessionId: string,
  opts: {
    title?: string;
    finishedToolUseIds?: string[];
  } = {},
): string {
  const path = parentJsonlPath(root, cwd, sessionId);
  const lines: string[] = [];

  if (opts.title) {
    lines.push(
      JSON.stringify({
        type: "ai-title",
        title: opts.title,
        sessionId,
        timestamp: new Date().toISOString(),
        uuid: `ai-title-${sessionId.slice(0, 8)}`,
      }),
    );
  }

  for (const toolUseId of opts.finishedToolUseIds ?? []) {
    lines.push(buildToolResultLine(sessionId, toolUseId));
  }

  writeFileSync(
    path,
    lines.length > 0 ? lines.join("\n") + "\n" : "",
    "utf8",
  );
  return path;
}

/**
 * Append a tool_result record to an existing parent JSONL.
 * Used mid-test to simulate a subagent finishing after the test scene was set up.
 * AC2: "subagent finishes" scenario — append the tool_result, then re-reduce.
 */
export function appendFinishedToolResult(
  root: string,
  cwd: string,
  sessionId: string,
  toolUseId: string,
): void {
  const path = parentJsonlPath(root, cwd, sessionId);
  appendFileSync(path, buildToolResultLine(sessionId, toolUseId) + "\n", "utf8");
}

function buildToolResultLine(sessionId: string, toolUseId: string): string {
  return JSON.stringify({
    type: "user",
    sessionId,
    timestamp: new Date().toISOString(),
    uuid: `tool-result-${toolUseId.slice(-8)}`,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: "<redacted>",
          is_error: false,
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Roster builder
// ---------------------------------------------------------------------------

/**
 * Write a roster YAML file into the given directory and return its path.
 * Content is loaded from tests/fixtures/ (AC3 — no synthesis).
 */
export function writeRoster(
  dir: string,
  fixtureName: string,
  filename: string = "teams.yaml",
): string {
  mkdirSync(dir, { recursive: true });
  const content = loadFixture(fixtureName);
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}
