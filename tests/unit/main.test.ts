/**
 * Unit tests for src/extension/main.ts.
 *
 * Coverage:
 *   - `handleOpenTranscript` derives the JSONL path from cwd + sessionId +
 *     agentId via cwdToSlug.
 *   - `handleOpenTranscript` shows an error message (no throw) when the
 *     session is not in the current state.
 *   - `handleOpenTranscript` shows an error message (no throw) when the
 *     resolved JSONL file does not exist on disk.
 *
 * Plus the AC7(e) absorbed-NIT-#1 verification: `context.subscriptions.length`
 * stays bounded across 3 `resolveWebviewView` cycles (the subscription leak
 * fix). That test lives in `tests/integration/subscriptionLeak.test.ts` —
 * see the file header there.
 *
 * Note (M3-02): the M2-06 `handleOpenRoster` function was retired when
 * `claudeteam.openRoster` adopted auto-create behavior. The new flow's
 * coverage lives in `tests/unit/openRoster.test.ts`.
 *
 * Source: src/extension/main.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC3
 *         team/nora-pl/milestone-3-backlog.md §M3-02 AC7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — capture window.showErrorMessage + showTextDocument calls.
// ---------------------------------------------------------------------------

const showErrorMessage = vi.fn();
const showTextDocument = vi.fn();

vi.mock("vscode", () => {
  return {
    window: {
      registerWebviewViewProvider: vi.fn(),
      showErrorMessage: (...args: unknown[]) => showErrorMessage(...args),
      showTextDocument: (...args: unknown[]) => showTextDocument(...args),
      showInformationMessage: vi.fn(),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: () => undefined }),
    },
    commands: { registerCommand: vi.fn() },
    Uri: {
      file: (p: string) => ({ fsPath: p, scheme: "file" }),
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        fsPath: `${base.fsPath}/${parts.join("/")}`,
        scheme: "file",
      }),
    },
    WebviewViewResolveContext: {},
    CancellationToken: {},
  };
});

import { handleOpenTranscript } from "../../src/extension/main.js";

// ---------------------------------------------------------------------------
// handleOpenTranscript
// ---------------------------------------------------------------------------

describe("handleOpenTranscript — AC3", () => {
  let tempRoot: string;

  beforeEach(() => {
    showErrorMessage.mockReset();
    showTextDocument.mockReset();
    tempRoot = mkdtempSync(join(tmpdir(), "ct-m2-06-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("opens the derived JSONL path when session + file exist", () => {
    const sessionId = "aaaabbbb-0000-0000-0000-00000000ac03";
    const agentId = "agent00000000abc1";
    const cwd = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
    const slug = "c--Trunk-PRIVATE-ClaudeTeam";
    const subagentsDir = join(tempRoot, "projects", slug, sessionId, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    const jsonlPath = join(subagentsDir, `agent-${agentId}.jsonl`);
    writeFileSync(jsonlPath, "{}\n");

    handleOpenTranscript(sessionId, agentId, tempRoot, () => ({
      sessions: [{ sessionId, cwd }],
    }));

    expect(showErrorMessage).not.toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const arg = showTextDocument.mock.calls[0]![0] as { fsPath: string };
    expect(arg.fsPath).toBe(jsonlPath);
  });

  // M4-03 AC6 / M4-01 §3.6 — preview-flag invariant. Drill-in opens the
  // JSONL as a PREVIEW tab so consecutive clicks REPLACE the tab rather
  // than accumulating tabs. Reversibility: one-line revert if dogfooding
  // finds the preview replacement annoying.
  it("opens the JSONL as a preview tab (M4-03 AC6 / M4-01 §3.6)", () => {
    const sessionId = "aaaabbbb-0000-0000-0000-0000000m4036";
    const agentId = "agent00000000pvw1";
    const cwd = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
    const slug = "c--Trunk-PRIVATE-ClaudeTeam";
    const subagentsDir = join(tempRoot, "projects", slug, sessionId, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, `agent-${agentId}.jsonl`), "{}\n");

    handleOpenTranscript(sessionId, agentId, tempRoot, () => ({
      sessions: [{ sessionId, cwd }],
    }));

    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const options = showTextDocument.mock.calls[0]![1] as
      | { preview?: boolean }
      | undefined;
    expect(options).toBeDefined();
    expect(options?.preview).toBe(true);
  });

  it("shows error (no throw) when sessionId not in current state", () => {
    handleOpenTranscript("missing-session", "agentX", tempRoot, () => ({
      sessions: [],
    }));

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("missing-session");
  });

  it("shows error (no throw) when getLastState returns null", () => {
    handleOpenTranscript("sid", "aid", tempRoot, () => null);

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it("shows error (no throw) when JSONL file is missing on disk", () => {
    const sessionId = "aaaabbbb-0000-0000-0000-00000000ac3b";
    const agentId = "agent00000000miss";
    const cwd = "c:\\Trunk\\PRIVATE\\ClaudeTeam";

    handleOpenTranscript(sessionId, agentId, tempRoot, () => ({
      sessions: [{ sessionId, cwd }],
    }));

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain(
      "transcript not found",
    );
  });
});

// handleOpenRoster (M2-06) was retired in M3-02 — the auto-creating
// `openRoster` flow replaces it. Coverage moved to
// `tests/unit/openRoster.test.ts`.
