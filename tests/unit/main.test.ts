/**
 * Unit tests for src/extension/main.ts (M2-06).
 *
 * Coverage:
 *   - `handleOpenTranscript` derives the JSONL path from cwd + sessionId +
 *     agentId via cwdToSlug.
 *   - `handleOpenTranscript` shows an error message (no throw) when the
 *     session is not in the current state.
 *   - `handleOpenTranscript` shows an error message (no throw) when the
 *     resolved JSONL file does not exist on disk.
 *   - `handleOpenRoster` opens the resolved roster path.
 *   - `handleOpenRoster` shows an error message when the path is null
 *     (view never resolved) or the file doesn't exist on disk.
 *
 * Plus the AC7(e) absorbed-NIT-#1 verification: `context.subscriptions.length`
 * stays bounded across 3 `resolveWebviewView` cycles (the subscription leak
 * fix). That test lives in `tests/integration/subscriptionLeak.test.ts` —
 * see the file header there.
 *
 * Source: src/extension/main.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC3, AC4
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

import {
  handleOpenTranscript,
  handleOpenRoster,
} from "../../src/extension/main.js";

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

// ---------------------------------------------------------------------------
// handleOpenRoster
// ---------------------------------------------------------------------------

describe("handleOpenRoster — AC4", () => {
  let tempRoot: string;

  beforeEach(() => {
    showErrorMessage.mockReset();
    showTextDocument.mockReset();
    tempRoot = mkdtempSync(join(tmpdir(), "ct-m2-06-roster-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("opens the roster file when path resolves AND file exists", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    writeFileSync(rosterPath, "teams: []\n");

    handleOpenRoster(rosterPath);

    expect(showErrorMessage).not.toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const arg = showTextDocument.mock.calls[0]![0] as { fsPath: string };
    expect(arg.fsPath).toBe(rosterPath);
  });

  it("shows error when rosterPath is null (view never resolved)", () => {
    handleOpenRoster(null);

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("not yet resolved");
  });

  it("shows error when rosterPath points to a non-existent file", () => {
    const rosterPath = join(tempRoot, "missing.yaml");

    handleOpenRoster(rosterPath);

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("not found");
  });
});
