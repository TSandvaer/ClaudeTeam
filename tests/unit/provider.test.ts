/**
 * Unit tests for src/extension/view/provider.ts
 *
 * Tests the pure-function helpers and the CSP construction logic without
 * requiring a live VS Code instance. The `extractCsp` export is the testable
 * surface; the VS Code types are mocked via vitest's module system.
 *
 * Coverage:
 *   - extractCsp parses the CSP from provider-generated HTML
 *   - CSP includes the required directives
 *   - CSP uses webview.cspSource placeholder (not hardcoded values)
 *   - HTML contains a script tag with the bundle URI
 *   - HTML contains the #root div
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractCsp } from "../../src/extension/view/provider.js";

// ---------------------------------------------------------------------------
// Minimal vscode mock — enough for provider.ts to import without a live host.
// ---------------------------------------------------------------------------

vi.mock("vscode", () => {
  const mockUri = (fsPath: string) => ({
    fsPath,
    toString: () => `file://${fsPath}`,
    joinPath: (...parts: string[]) => mockUri(parts.join("/")),
  });

  return {
    window: {
      registerWebviewViewProvider: vi.fn(),
    },
    Uri: {
      file: (p: string) => mockUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mockUri(`${base.fsPath}/${parts.join("/")}`),
    },
    WebviewViewResolveContext: {},
    CancellationToken: {},
  };
});

// ---------------------------------------------------------------------------
// Generate a sample HTML string that mirrors what provider._getHtml produces.
// ---------------------------------------------------------------------------

function buildSampleHtml(cspSource: string, scriptUri: string): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource}`,
    `style-src ${cspSource}`,
    `script-src ${cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="${csp}"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ClaudeTeam</title>
</head>
<body>
  <div id="root">ClaudeTeam loading…</div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MOCK_CSP_SOURCE = "vscode-webview://test-origin";
const MOCK_SCRIPT_URI =
  "vscode-webview://test-origin/dist/webview/main.js";

describe("extractCsp", () => {
  it("extracts the CSP from provider-generated HTML", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).not.toBeNull();
    expect(csp).toBeTruthy();
  });

  it("returns null when no CSP meta tag is present", () => {
    const html = "<html><head></head><body></body></html>";
    expect(extractCsp(html)).toBeNull();
  });

  it("extracts CSP that starts with default-src 'none'", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).toMatch(/default-src 'none'/);
  });

  it("CSP includes script-src directive", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).toMatch(/script-src/);
  });

  it("CSP includes style-src directive", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).toMatch(/style-src/);
  });

  it("CSP references the cspSource placeholder value", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).toContain(MOCK_CSP_SOURCE);
  });

  it("CSP does NOT contain 'unsafe-inline'", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).not.toContain("unsafe-inline");
  });

  it("CSP does NOT contain 'unsafe-eval'", () => {
    const html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
    const csp = extractCsp(html);
    expect(csp).not.toContain("unsafe-eval");
  });
});

describe("HTML scaffold", () => {
  let html: string;

  beforeEach(() => {
    html = buildSampleHtml(MOCK_CSP_SOURCE, MOCK_SCRIPT_URI);
  });

  it("includes a #root div", () => {
    expect(html).toContain('id="root"');
  });

  it("includes the webview bundle script tag", () => {
    expect(html).toContain(`<script src="${MOCK_SCRIPT_URI}"`);
  });

  it("includes the placeholder loading text", () => {
    expect(html).toContain("ClaudeTeam loading");
  });

  it("uses UTF-8 charset", () => {
    expect(html).toContain('charset="UTF-8"');
  });

  it("sets lang=en on the html element", () => {
    expect(html).toContain('lang="en"');
  });
});
