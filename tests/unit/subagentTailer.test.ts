// Subagent JSONL tailer unit tests.
//
// Coverage targets (from M1-06 AC6 + Sage test plan §M1-06):
//   - subagent-running.jsonl  (real capture, ends mid-action)
//   - subagent-finished.jsonl (real lines 1-6 + synthesized closing line 7;
//                              note: per Bram M1-11, real subagent JSONLs
//                              never carry a closing assistant message —
//                              we still extract sensible activity)
//   - subagent-malformed.jsonl (mixed valid + malformed lines)
//   - missing file              (returns empty sentinel, no throw)
//   - empty file                (returns empty sentinel with mtimeMs)
//   - file with only metadata records, no assistant content
//   - last assistant message has multiple tool_use entries → LAST one returned
//   - last assistant message has only text content → lastTool null, model resolved
//   - performance: 50MB JSONL handled in <100ms (per AC2)
//   - no-trailing-newline (partial mid-write flush)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readActivity } from "../../src/extension/watcher/subagentTailer.js";

const FIXTURES = join(__dirname, "..", "fixtures");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "subagent-tailer-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// =============================================================================
// Fixture-driven tests
// =============================================================================

describe("readActivity — real fixtures", () => {
  it("subagent-running.jsonl: extracts model + last tool_use", async () => {
    const path = join(FIXTURES, "subagent-running.jsonl");
    const got = await readActivity(path);

    // Model is on every assistant record's message.model — first one wins.
    expect(got.model).toBe("claude-opus-4-7");

    // Per fixture inspection: the LAST type:"assistant" record (line 18) is
    // a text-only ("Now npm install and run the done-when test.") message,
    // so lastTool is null. Walking backward: line 16 is the LAST assistant
    // with a tool_use, but the tailer's contract is "most recent assistant
    // message" — and line 18 IS more recent. Confirms text-only branch.
    //
    // Source: tests/fixtures/subagent-running.jsonl line 18.
    expect(got.lastTool).toBeNull();

    // mtimeMs must be a positive number (file exists on disk).
    expect(got.mtimeMs).toBeGreaterThan(0);

    // lastTimestamp from line 18's timestamp "2026-05-23T10:54:54.379Z".
    expect(got.lastTimestamp).toBe(Date.parse("2026-05-23T10:54:54.379Z"));
  });

  it("subagent-finished.jsonl: extracts model + reports last activity + flags isFinished (Obs 13)", async () => {
    const path = join(FIXTURES, "subagent-finished.jsonl");
    const got = await readActivity(path);

    // Per Bram's Obs 13 triage (2026-05-26), the M1-11 claim that
    // sub-agent JSONLs never end with a closing assistant message was
    // wrong — completed background agents DO end on
    // `type:"assistant", stop_reason:"end_turn"`. This fixture's line 7
    // (a synthesized closing assistant text with stop_reason=end_turn) is
    // now intentional rather than coincidental — it stands in for a real
    // closing record.
    expect(got.model).toBe("claude-opus-4-7");

    // Line 7 is text-only — lastTool null is the correct projection.
    expect(got.lastTool).toBeNull();
    expect(got.mtimeMs).toBeGreaterThan(0);
    expect(got.lastTimestamp).toBe(Date.parse("2026-05-23T09:53:20.000Z"));
    // Obs 13: the synthesized closing line has stop_reason=end_turn.
    expect(got.isFinished).toBe(true);
  });

  it("subagent-malformed.jsonl: skips bad lines, returns sentinel when no valid assistant remains", async () => {
    const path = join(FIXTURES, "subagent-malformed.jsonl");
    const got = await readActivity(path);

    // The malformed fixture contains:
    //   line 1: valid user record (not assistant)
    //   line 2: truncated assistant (no closing brace) — must skip
    //   line 3: plain text "NOT_VALID_JSON_LINE_NO_CLOSING_BRACE" — must skip
    //
    // No valid assistant record → model + lastTool null.
    expect(got.model).toBeNull();
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(0);
    // File exists on disk → mtimeMs is real.
    expect(got.mtimeMs).toBeGreaterThan(0);
  });
});

// =============================================================================
// Missing / empty
// =============================================================================

describe("readActivity — missing / empty", () => {
  it("missing file: returns empty sentinel, does not throw", async () => {
    const path = join(tempDir, "does-not-exist.jsonl");
    const got = await readActivity(path);

    expect(got.model).toBeNull();
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(0);
    expect(got.mtimeMs).toBe(0);
  });

  it("empty file: returns empty sentinel with real mtimeMs", async () => {
    const path = join(tempDir, "empty.jsonl");
    writeFileSync(path, "");
    const got = await readActivity(path);

    expect(got.model).toBeNull();
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(0);
    expect(got.mtimeMs).toBeGreaterThan(0);
  });
});

// =============================================================================
// Synthesized scenarios (small inline JSONL strings for branch coverage)
// =============================================================================

describe("readActivity — synthesized scenarios", () => {
  it("metadata-only file (no assistant records): model + lastTool both null", async () => {
    // Only user / metadata records, no type:"assistant"
    const path = join(tempDir, "metadata-only.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-01-01T00:00:00Z"}`,
        `{"type":"queue-operation","timestamp":"2026-01-01T00:00:01Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBeNull();
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(0);
    expect(got.mtimeMs).toBeGreaterThan(0);
  });

  it("multiple tool_use entries in last assistant: returns the LAST one (AC3)", async () => {
    const path = join(tempDir, "multi-tool.jsonl");
    writeFileSync(
      path,
      [
        // First assistant — provides the model.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"hi"}]},"timestamp":"2026-01-01T00:00:00Z"}`,
        // Last assistant — multiple tool_use entries.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"running"},{"type":"tool_use","id":"t1","name":"Bash","input":{}},{"type":"tool_use","id":"t2","name":"Read","input":{}},{"type":"tool_use","id":"t3","name":"Edit","input":{}}]},"timestamp":"2026-01-01T00:01:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBe("Edit"); // LAST, not first
    expect(got.lastTimestamp).toBe(Date.parse("2026-01-01T00:01:00Z"));
  });

  it("last assistant has only text content: lastTool null, model still resolved (AC3)", async () => {
    const path = join(tempDir, "text-only-last.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]},"timestamp":"2026-01-01T00:00:00Z"}`,
        `{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":"ok"}]},"timestamp":"2026-01-01T00:00:01Z"}`,
        // LAST assistant — text only.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"all done"}]},"timestamp":"2026-01-01T00:00:02Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(Date.parse("2026-01-01T00:00:02Z"));
  });

  it("malformed line in middle: skipped, valid lines around it parsed (AC4)", async () => {
    const path = join(tempDir, "mid-corruption.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"start"}]},"timestamp":"2026-01-01T00:00:00Z"}`,
        // Truncated mid-write — no closing brace.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","name":"Bash"`,
        // Plain garbage.
        `NOT_VALID_JSON`,
        // Valid assistant with tool_use — should be the "last" one returned.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t9","name":"Grep","input":{}}]},"timestamp":"2026-01-01T00:00:30Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBe("Grep");
    expect(got.lastTimestamp).toBe(Date.parse("2026-01-01T00:00:30Z"));
  });

  it("no trailing newline (partial mid-write flush): partial last line skipped, prior lines extracted", async () => {
    const path = join(tempDir, "partial-tail.jsonl");
    // Last "record" is a partial JSON object without a closing brace AND
    // without a terminating newline — simulates mid-write flush.
    const body =
      `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]},"timestamp":"2026-01-01T00:00:00Z"}\n` +
      `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use`;
    writeFileSync(path, body);

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    // Partial last line is unparseable — falls back to the prior assistant.
    expect(got.lastTool).toBe("Bash");
    expect(got.lastTimestamp).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("assistant record with non-array content: gracefully returns null lastTool", async () => {
    const path = join(tempDir, "weird-content.jsonl");
    writeFileSync(
      path,
      [
        // content is a string, not an array — defensive branch.
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":"oops"},"timestamp":"2026-01-01T00:00:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBeNull();
    expect(got.lastTimestamp).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("tool_use entry with non-string name: returns null (does not coerce)", async () => {
    const path = join(tempDir, "bad-tool-name.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t1","name":null,"input":{}}]},"timestamp":"2026-01-01T00:00:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBeNull();
  });
});

// =============================================================================
// Obs 13 / 86c9zmp5g — stop_reason=end_turn → isFinished:true
// =============================================================================

describe("readActivity — isFinished detection (Obs 13)", () => {
  it("subagent-running.jsonl: no stop_reason on last assistant → isFinished:false", async () => {
    // The fixture's last assistant message (line 18) is mid-action text;
    // it has no stop_reason. The backward pass must NOT flag isFinished.
    const path = join(FIXTURES, "subagent-running.jsonl");
    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
  });

  it("last assistant has stop_reason:end_turn → isFinished:true", async () => {
    const path = join(tempDir, "closed.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"start"}]},"timestamp":"2026-01-01T00:00:00Z"}`,
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"done"}],"stop_reason":"end_turn"},"timestamp":"2026-01-01T00:00:30Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.isFinished).toBe(true);
    // Other fields still resolve correctly.
    expect(got.model).toBe("claude-opus-4-7");
    expect(got.lastTool).toBeNull();
  });

  it("last assistant has stop_reason:tool_use → isFinished:false (only end_turn counts)", async () => {
    // Mid-conversation assistant messages typically carry stop_reason:tool_use
    // when they hand off to a tool. That's not a completion signal.
    const path = join(tempDir, "tool-use.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}],"stop_reason":"tool_use"},"timestamp":"2026-01-01T00:00:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
    expect(got.lastTool).toBe("Bash");
  });

  it("last assistant has stop_reason:null → isFinished:false (mid-write snapshot)", async () => {
    // Per Obs 13 triage E2: 4/18 agents in session 5652d46e captured with
    // empty stop_reason (mid-write at capture time). Must NOT flag finished.
    const path = join(tempDir, "midwrite.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"thinking"}],"stop_reason":null},"timestamp":"2026-01-01T00:00:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
  });

  it("last assistant has stop_reason:'' (empty string) → isFinished:false", async () => {
    // Same class as null — observed in session 5652d46e mid-write captures.
    const path = join(tempDir, "empty-stop.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"x"}],"stop_reason":""},"timestamp":"2026-01-01T00:00:00Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
  });

  it("earlier assistant has end_turn but LAST is mid-action → isFinished:false (backward pass picks LAST)", async () => {
    // Defensive: only the LAST assistant in the backward pass governs.
    // If a transcript happens to contain an earlier end_turn (e.g. resumed
    // session), and the LAST assistant is mid-action, we are NOT finished.
    const path = join(tempDir, "resumed.jsonl");
    writeFileSync(
      path,
      [
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"first turn"}],"stop_reason":"end_turn"},"timestamp":"2026-01-01T00:00:00Z"}`,
        `{"type":"user","message":{"role":"user","content":"continue"},"timestamp":"2026-01-01T00:01:00Z"}`,
        `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"t1","name":"Grep","input":{}}],"stop_reason":"tool_use"},"timestamp":"2026-01-01T00:01:30Z"}`,
      ].join("\n") + "\n",
    );

    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
    expect(got.lastTool).toBe("Grep");
  });

  it("missing file: isFinished defaults to false (EMPTY_ACTIVITY)", async () => {
    const path = join(tempDir, "missing.jsonl");
    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
  });

  it("empty file: isFinished:false", async () => {
    const path = join(tempDir, "empty.jsonl");
    writeFileSync(path, "");
    const got = await readActivity(path);
    expect(got.isFinished).toBe(false);
  });
});

// =============================================================================
// Performance — AC2 (50MB JSONL in <100ms)
// =============================================================================

describe("readActivity — performance (AC2)", () => {
  it("handles a 50MB JSONL in <100ms (tail-window read, not full-file)", async () => {
    const path = join(tempDir, "big.jsonl");

    // Build a ~50MB file by repeating a realistic-sized record. Each record
    // is ~1.5 KiB; ~35000 records → ~50 MB.
    // Truncate/pad to land within ~5 MB of target. Speed of the build itself
    // is irrelevant to the perf assertion — we only time readActivity.
    const fillerRecord =
      `{"type":"user","message":{"role":"user","content":"${"x".repeat(1400)}"},"timestamp":"2026-01-01T00:00:00Z"}\n`;
    const targetBytes = 50 * 1024 * 1024;
    const head = `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"text","text":"head"}]},"timestamp":"2026-01-01T00:00:00Z"}\n`;
    const tailToolRecord =
      `{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"tlast","name":"Grep","input":{}}]},"timestamp":"2026-01-01T00:01:00Z"}\n`;

    // Stream-write via fs.appendFileSync chunks so we don't allocate one
    // giant string. Each chunk ≈ 1MB.
    const chunkSize = Math.floor((1024 * 1024) / fillerRecord.length);
    const chunk = fillerRecord.repeat(chunkSize);
    const { appendFileSync, writeFileSync: wf } = await import("node:fs");
    wf(path, head);
    let written = head.length;
    while (written < targetBytes - chunk.length - tailToolRecord.length) {
      appendFileSync(path, chunk);
      written += chunk.length;
    }
    appendFileSync(path, tailToolRecord);

    const t0 = performance.now();
    const got = await readActivity(path);
    const dt = performance.now() - t0;

    // The tail window CANNOT see the head's first-assistant record, so
    // `model` will be null in this synthetic case. That's expected — see
    // implementation note "MODEL = FIRST ASSISTANT MESSAGE'S model" for
    // the V1 tradeoff. The activity (lastTool) MUST be correct.
    expect(got.lastTool).toBe("Grep");

    // Performance assertion — <100ms per AC2.
    expect(dt).toBeLessThan(100);
  }, 30_000); // Allow generous timeout for the FILE BUILD; the assertion itself measures only the read.
});
