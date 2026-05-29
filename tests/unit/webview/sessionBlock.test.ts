/**
 * @vitest-environment jsdom
 *
 * Component tests for sessionBlock's 86ca03nww label resolution + gitBranch
 * chip rendering.
 *
 * Coverage:
 *   - Title text uses `resolveSessionLabel` priority chain (customTitle >
 *     aiTitle > workspace-folder fallback)
 *   - `data-label-source` attribute reflects the tier that resolved
 *   - gitBranch chip renders only when SessionTree.gitBranch is set
 *   - gitBranch chip uses VS Code theme variables (no hardcoded colors —
 *     verified indirectly via .session-git-branch class hookup)
 *   - Back-compat: SessionTree without customTitle / gitBranch renders
 *     exactly as it did pre-86ca03nww (no extra DOM nodes)
 *
 * Source: ticket 86ca03nww vocabulary contract; spec 86c9zmyef.
 */

import { describe, it, expect, vi } from "vitest";
import type { SessionTree } from "../../../src/shared/types.js";
import { renderSessionBlock } from "../../../src/webview/components/sessionBlock.js";

function makeSession(overrides: Partial<SessionTree> = {}): SessionTree {
  return {
    shortId: "7b53d0ee",
    sessionId: "7b53d0ee-da11-4c38-9899-a9c24b754b93",
    pid: 68644,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "(no title yet)",
    rosterTiles: new Map(),
    teamOrder: [],
    background: [],
    ...overrides,
  };
}

describe("sessionBlock — session label resolution (86ca03nww)", () => {
  it("customTitle wins: renders sponsor rename as the title text", () => {
    const block = renderSessionBlock({
      session: makeSession({
        title: "AI-generated title",
        customTitle: "claude team",
      }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    expect(span?.textContent).toBe("claude team");
    expect(span?.getAttribute("data-label-source")).toBe("custom-title");
  });

  it("aiTitle wins when customTitle is absent", () => {
    const block = renderSessionBlock({
      session: makeSession({ title: "Resume shipped rule8 session" }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    expect(span?.textContent).toBe("Resume shipped rule8 session");
    expect(span?.getAttribute("data-label-source")).toBe("ai-title");
  });

  it("workspace-folder fallback when both customTitle and aiTitle are absent", () => {
    // `title: "(no title yet)"` is the sentinel set by the host when no
    // ai-title record was found. The resolver treats it as absent.
    const block = renderSessionBlock({
      session: makeSession({
        title: "(no title yet)",
        cwd: "c:\\Trunk\\PRIVATE\\MARIAN-TUTOR",
      }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    expect(span?.textContent).toBe("MARIAN-TUTOR");
    expect(span?.getAttribute("data-label-source")).toBe("workspace-folder");
  });

  it("aiTitle sentinel does NOT block customTitle", () => {
    // Common live shape: no ai-title written yet, but sponsor renamed.
    const block = renderSessionBlock({
      session: makeSession({
        title: "(no title yet)",
        customTitle: "Working on PBI #41",
      }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    expect(span?.textContent).toBe("Working on PBI #41");
  });

  it("empty / whitespace customTitle falls through to aiTitle", () => {
    const block = renderSessionBlock({
      session: makeSession({
        title: "AI title",
        customTitle: "   ",
      }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    expect(span?.textContent).toBe("AI title");
    expect(span?.getAttribute("data-label-source")).toBe("ai-title");
  });

  it("label source tooltip surfaces resolution tier (cwd folded in — 86ca18bc2 §5.2)", () => {
    const block = renderSessionBlock({
      session: makeSession({
        customTitle: "team",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    // 86ca18bc2: cwd now folds into the title tooltip (§5.2 demotes the
    // standalone .session-cwd span); the resolution-tier note is composed
    // after it on a second line.
    expect(span?.getAttribute("title")).toBe(
      "c:\\Trunk\\PRIVATE\\ClaudeTeam\nSponsor rename (custom-title)",
    );
  });
});

describe("sessionBlock — corrected title hierarchy (86ca18bc2 §5)", () => {
  it("resolved title leads the header in DOM order, UUID chip is demoted to the trailing edge", () => {
    const block = renderSessionBlock({
      session: makeSession({
        customTitle: "claude team - continued",
        gitBranch: "main",
      }),
      postMessage: vi.fn(),
    });
    const title = block.querySelector(".session-title");
    const idChip = block.querySelector(".session-id");
    expect(title?.textContent).toBe("claude team - continued");
    expect(idChip).not.toBeNull();
    // The title must precede the demoted UUID chip in document order — this
    // is the load-bearing hierarchy assertion: the human label dominates and
    // the `SESSION {shortId}` element is pushed to the trailing edge.
    expect(
      title!.compareDocumentPosition(idChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("UUID chip keeps the short id visible (not tooltip-only) + folds pid into its tooltip", () => {
    const block = renderSessionBlock({
      session: makeSession({ shortId: "7b53d0ee", pid: 68644 }),
      postMessage: vi.fn(),
    });
    const idChip = block.querySelector(".session-id");
    // The short id stays in the visible chip text (load-bearing for grepping
    // JSONLs/logs per §5.3) — the decorative glyph lives in an aria-hidden
    // child, so the chip's textContent carries the glyph + the id.
    expect(idChip?.textContent).toContain("7b53d0ee");
    // pid is demoted from a standalone span into the chip's tooltip (§5.2).
    expect(idChip?.getAttribute("title")).toBe(
      "session id 7b53d0ee · pid=68644",
    );
    // aria-label text-pairs the chip for screen readers.
    expect(idChip?.getAttribute("aria-label")).toBe("session id");
    // The decorative glyph is hidden from the accessibility tree.
    expect(
      idChip?.querySelector(".session-id-glyph")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("no standalone .session-pid / .session-cwd spans remain (folded into tooltips)", () => {
    const block = renderSessionBlock({
      session: makeSession(),
      postMessage: vi.fn(),
    });
    expect(block.querySelector(".session-pid")).toBeNull();
    expect(block.querySelector(".session-cwd")).toBeNull();
  });
});

describe("sessionBlock — gitBranch chip (86ca03nww)", () => {
  it("renders the chip when SessionTree.gitBranch is set", () => {
    const block = renderSessionBlock({
      session: makeSession({ gitBranch: "felix/86ca03nww-x" }),
      postMessage: vi.fn(),
    });
    const chip = block.querySelector(".session-git-branch");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("felix/86ca03nww-x");
    expect(chip?.getAttribute("title")).toBe(
      "git branch: felix/86ca03nww-x",
    );
    expect(chip?.getAttribute("data-git-branch")).toBe("felix/86ca03nww-x");
  });

  it("does NOT render the chip when gitBranch is absent (back-compat)", () => {
    const block = renderSessionBlock({
      session: makeSession(), // no gitBranch
      postMessage: vi.fn(),
    });
    expect(block.querySelector(".session-git-branch")).toBeNull();
  });

  it("does NOT render the chip when gitBranch is empty string", () => {
    const block = renderSessionBlock({
      session: makeSession({ gitBranch: "" }),
      postMessage: vi.fn(),
    });
    expect(block.querySelector(".session-git-branch")).toBeNull();
  });

  it("renders chip alongside title (both present)", () => {
    const block = renderSessionBlock({
      session: makeSession({
        customTitle: "claude team",
        gitBranch: "main",
      }),
      postMessage: vi.fn(),
    });
    const title = block.querySelector(".session-title");
    const chip = block.querySelector(".session-git-branch");
    expect(title?.textContent).toBe("claude team");
    expect(chip?.textContent).toBe("main");
    // Chip should follow the title in document order.
    expect(
      title!.compareDocumentPosition(chip!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });
});

describe("sessionBlock — dead session back-compat (86ca03nww does NOT regress)", () => {
  it("dead session still renders header-only (no tiles, no chips beyond gitBranch + dead-badge)", () => {
    const block = renderSessionBlock({
      session: makeSession({
        isAlive: false,
        customTitle: "claude team",
        gitBranch: "main",
      }),
      postMessage: vi.fn(),
    });
    expect(block.classList.contains("session-block--dead")).toBe(true);
    // Dead badge always renders.
    expect(block.querySelector(".session-dead-badge")).not.toBeNull();
    // Label + branch chip still render in the header (the 86ca03nww surface
    // is per the spec for live sessions; for dead sessions the header
    // remains intact so the sponsor sees what the session WAS labelled).
    expect(block.querySelector(".session-title")?.textContent).toBe(
      "claude team",
    );
    expect(block.querySelector(".session-git-branch")?.textContent).toBe(
      "main",
    );
  });
});
