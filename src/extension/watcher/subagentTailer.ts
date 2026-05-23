// Subagent JSONL tailer — reads the tail of a subagent transcript JSONL and
// extracts the resolved model + current activity (last tool_use).
//
// Source contract: .claude/docs/data-sources.md §3 (Subagent transcript).
//
// Key design decisions:
//
// 1. TAIL-ONLY READ. JSONL files can grow to many MB during long sessions
//    (50MB+ observed in practice). Loading the entire file via readFile is
//    O(filesize) — unacceptable. We use fs.open + fs.read with a fixed
//    tail-byte window (~256 KiB ≈ 100+ lines at typical record sizes seen
//    in fixtures). For files < window size we just read the whole thing.
//
// 2. MODEL = FIRST ASSISTANT MESSAGE'S model. The spawn-time model field
//    is empty for custom-persona spawns (per data-sources.md §3). The
//    resolved model only appears on the FIRST `type:"assistant"` record.
//    A pure tail-read MIGHT miss this on very large files if the first
//    assistant message has already scrolled out of the tail window. For
//    V1 we accept this — practical files are well under window size, and
//    when in doubt the reducer just renders `model:?`. A future M-tier
//    optimization could two-pass (head + tail). Out of scope here.
//
// 3. LAST tool_use = activity. Walk records backwards from the tail; the
//    most recent `type:"assistant"` record's LAST `tool_use` content
//    entry's `name` is the agent's current/last activity.
//
// 4. NO "FINISHED" INFERENCE. Per Bram's M1-11 finding (data-sources.md
//    §3 "JSONL closing semantics"), subagent JSONLs NEVER carry a closing
//    assistant message in the wild. The reducer (M1-09) detects finished
//    state by cross-referencing the parent transcript's `tool_result`
//    with `meta.json.toolUseId`. This tailer reports "what was last
//    happening" regardless of whether the agent has actually finished.
//
// 5. MALFORMED LINES. We never throw on a single bad line — we skip it
//    and continue. JSONL is line-oriented; one corruption (truncated
//    mid-write flush, partial line from the head of our tail-read
//    window) does not invalidate the rest.
//
// 6. MISSING / EMPTY FILE. Returns a sentinel SubagentActivity with all
//    nulls/zeros — never throws. Callers can distinguish "no data yet"
//    from "data present but no tool yet" by inspecting `mtimeMs`.

import { open, stat } from "node:fs/promises";
import type { SubagentActivity } from "../../shared/types.js";

/**
 * Size of the tail window in bytes. ~256 KiB.
 *
 * Empirical observation (M1-02 fixtures + live ClaudeTeam sessions): a
 * single JSONL record averages ~1.5 KiB. 256 KiB easily holds 100+ records.
 * Increase if downstream observation shows records growing significantly.
 */
const TAIL_BYTES = 256 * 1024;

/** Returned when the file is missing or empty. */
const EMPTY_ACTIVITY: SubagentActivity = {
  model: null,
  lastTool: null,
  lastTimestamp: 0,
  mtimeMs: 0,
};

/**
 * Read the tail of a subagent JSONL and extract activity.
 *
 * Never throws on:
 *   - missing file
 *   - empty file
 *   - malformed JSONL lines (skipped individually)
 *   - records with no model / no tool_use
 *
 * Will propagate fs errors OTHER than ENOENT (e.g. EACCES) — those are
 * environmental problems the caller should know about.
 */
export async function readActivity(jsonlPath: string): Promise<SubagentActivity> {
  // ---- Stat ----------------------------------------------------------------
  let mtimeMs: number;
  let size: number;
  try {
    const s = await stat(jsonlPath);
    mtimeMs = s.mtimeMs;
    size = s.size;
  } catch (err) {
    if (isNodeErr(err) && err.code === "ENOENT") {
      return EMPTY_ACTIVITY;
    }
    throw err;
  }

  if (size === 0) {
    return { ...EMPTY_ACTIVITY, mtimeMs };
  }

  // ---- Read tail window ----------------------------------------------------
  const start = Math.max(0, size - TAIL_BYTES);
  const length = size - start;
  const buf = Buffer.allocUnsafe(length);

  const fh = await open(jsonlPath, "r");
  try {
    await fh.read(buf, 0, length, start);
  } finally {
    await fh.close();
  }

  // ---- Slice into lines ----------------------------------------------------
  let text = buf.toString("utf8");
  // If we read from a non-zero offset, the first "line" is almost certainly
  // a partial fragment of a record we sliced through. Drop it.
  if (start > 0) {
    const firstNl = text.indexOf("\n");
    if (firstNl === -1) {
      // Tail window contains no newline at all — nothing parseable.
      return { ...EMPTY_ACTIVITY, mtimeMs };
    }
    text = text.slice(firstNl + 1);
  }

  // Final trailing newline (if present) yields an empty trailing entry;
  // split + filter handles that. We also handle "no trailing newline"
  // (partial flush) — the final line may be mid-write and unparseable.
  // We attempt to parse it; on failure we just skip it like any malformed
  // line.
  const lines = text.split("\n");

  // ---- Walk forward for model (first assistant record) --------------------
  // ---- Walk backward for lastTool (most recent assistant with tool_use) ---
  //
  // Two passes is simpler than threading state through one pass. Each pass
  // is O(N) over the tail line buffer which is bounded.

  let model: string | null = null;
  let lastTool: string | null = null;
  let lastTimestamp = 0;

  // Forward pass: first assistant with a resolved model wins.
  for (const line of lines) {
    if (line.length === 0) continue;
    const rec = tryParse(line);
    if (rec === null) continue;
    if (!isAssistantRecord(rec)) continue;
    const m = extractModel(rec);
    if (m !== null) {
      model = m;
      break;
    }
  }

  // Backward pass: most recent assistant with a tool_use OR text content.
  // We capture lastTimestamp from the most recent assistant we see, even
  // if it has no tool_use (text-only). That matches AC3: "last assistant
  // message has only text content (lastTool = null, model still resolved)".
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    const rec = tryParse(line);
    if (rec === null) continue;
    if (!isAssistantRecord(rec)) continue;

    lastTimestamp = extractTimestampMs(rec);
    lastTool = extractLastToolName(rec); // null if text-only
    break;
  }

  return {
    model,
    lastTool,
    lastTimestamp,
    mtimeMs,
  };
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Parse a JSONL line. Returns the parsed object on success, null on any
 * failure (malformed JSON, non-object root, etc.). NEVER throws.
 */
function tryParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Record is `{ type: "assistant", message: {...} }`. */
function isAssistantRecord(rec: Record<string, unknown>): boolean {
  if (rec["type"] !== "assistant") return false;
  const msg = rec["message"];
  return typeof msg === "object" && msg !== null && !Array.isArray(msg);
}

/**
 * Extract `message.model` if present and non-empty. Returns null otherwise.
 * Per data-sources.md §3: the resolved model lives on the assistant record's
 * `message.model`.
 */
function extractModel(rec: Record<string, unknown>): string | null {
  const msg = rec["message"] as Record<string, unknown>;
  const m = msg["model"];
  if (typeof m === "string" && m.length > 0) return m;
  return null;
}

/**
 * Extract the LAST `tool_use` entry's `name` from the assistant record's
 * `message.content[]`. Returns null when:
 *   - content is not an array
 *   - no entry has type === "tool_use"
 *   - the tool_use entry has no string `name`
 *
 * Per M1-06 AC3: when multiple tool_use entries exist, return the LAST one.
 */
function extractLastToolName(rec: Record<string, unknown>): string | null {
  const msg = rec["message"] as Record<string, unknown>;
  const content = msg["content"];
  if (!Array.isArray(content)) return null;

  // Walk backwards through content[] — first tool_use we hit IS the last.
  for (let i = content.length - 1; i >= 0; i--) {
    const entry = content[i];
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>)["type"] === "tool_use"
    ) {
      const name = (entry as Record<string, unknown>)["name"];
      if (typeof name === "string") return name;
      return null;
    }
  }
  return null;
}

/**
 * Parse the record's top-level `timestamp` (ISO-8601 string) into epoch ms.
 * Returns 0 sentinel on missing/unparseable timestamp.
 */
function extractTimestampMs(rec: Record<string, unknown>): number {
  const ts = rec["timestamp"];
  if (typeof ts !== "string") return 0;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Narrow unknown to NodeJS.ErrnoException for `.code` inspection. */
function isNodeErr(err: unknown): err is NodeJS.ErrnoException {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}
