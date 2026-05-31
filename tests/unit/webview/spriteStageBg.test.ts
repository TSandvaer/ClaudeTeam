// Source-derived guard for the light sprite-stage background (86ca23utq).
//
// This is a CSS-only visual change — the true acceptance is the sponsor's live
// preview (visual fidelity is sponsor-gated per the sub-agent GUI-gap reframe).
// What IS headlessly assertable, and what this test pins, is the structural
// contract that makes the visual change possible at all:
//
//   1. `:root` defines the `--ct-sprite-stage-bg` token (kept in a token so the
//      sponsor can tweak the exact hex live without editing the rule).
//   2. `.sprite-box` consumes it as `background-color` + a `border-radius`.
//
// Non-vacuity: reverting EITHER edit (drop the token, or remove the
// background-color/border-radius from `.sprite-box`) makes this fail. A future
// refactor that accidentally strips the stage would be caught here rather than
// only surfacing in a manual reload.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("sprite stage background (86ca23utq)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..");
  const css = readFileSync(
    join(root, "src", "webview", "styles", "dashboard.css"),
    "utf8",
  );
  // Strip comments + collapse whitespace so the assertions tolerate reformats.
  const normalized = css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

  it("defines the --ct-sprite-stage-bg token in :root", () => {
    // Token must exist with a concrete value (declaration end is `;`).
    expect(normalized).toMatch(/--ct-sprite-stage-bg:\s*[^;]+;/);
  });

  it("defines the --ct-sprite-stage-radius token in :root", () => {
    expect(normalized).toMatch(/--ct-sprite-stage-radius:\s*[^;]+;/);
  });

  it(".sprite-box applies the stage token as background-color + border-radius", () => {
    // There are multiple rules whose selector ENDS in `.sprite-box` (e.g. the
    // grid-placement rule `.agent-tile[...] > .sprite-box`). Collect every
    // `.sprite-box {...}` rule body and assert at least one carries BOTH the
    // stage background-color and border-radius — that's the standalone styling
    // rule we extended.
    const bodies = [...normalized.matchAll(/\.sprite-box\s*\{([^}]*)\}/g)].map(
      (m) => m[1],
    );
    expect(bodies.length, "no .sprite-box rule found in dashboard.css").toBeGreaterThan(0);
    const styled = bodies.find(
      (b) =>
        /background-color:\s*var\(--ct-sprite-stage-bg\)/.test(b) &&
        /border-radius:\s*var\(--ct-sprite-stage-radius\)/.test(b),
    );
    expect(
      styled,
      "no .sprite-box rule applies both --ct-sprite-stage-bg and --ct-sprite-stage-radius",
    ).toBeDefined();
  });
});
