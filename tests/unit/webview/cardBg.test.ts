// Source-derived guard for the light WHOLE-CARD background (86ca23utq).
//
// Sponsor pivoted 2026-05-31 from the stage-only treatment (light bg on
// `.sprite-box` only) to lighting the ENTIRE agent card — the container that
// carries the blue selected/focus border — and flipping all card text + chrome
// dark-on-light for contrast. The visual fidelity (the exact feel of the light
// card, theme contrast) is sponsor-gated per the sub-agent GUI-gap reframe; what
// IS headlessly assertable, and what this test pins, is the structural contract
// that makes the change correct + complete:
//
//   1. `:root` defines `--ct-card-bg` + `--ct-card-radius` (kept in tokens so the
//      sponsor can tweak the exact hex live without editing the rule) AND the
//      dark-on-light text/chrome tokens (`--ct-card-fg`, `--ct-card-fg-muted`,
//      `--ct-card-hover`, `--ct-card-hairline`).
//   2. `.agent-tile` (the selected-border container) consumes `--ct-card-bg` as
//      `background-color` + a delineating `border` (the light-theme cue).
//   3. The card TEXT (`.agent-display`, `.agent-role`) consumes the DARK
//      `--ct-card-fg` / `--ct-card-fg-muted` — NOT the default `--ct-color-fg`
//      (which is light in dark theme and would fail contrast on the light card).
//   4. The blue SELECTED border (`--ct-color-focus`) is still applied on
//      `.agent-tile:hover, :focus-visible` (unchanged by the pivot).
//   5. The redundant stage panel is FOLDED IN — `.sprite-box` no longer paints
//      its own light background (the whole card is light, so a separate stage
//      would double-paint).
//
// Non-vacuity: reverting ANY of these edits makes a `describe` fail —
//   - drop a token             → token-existence assertions fail
//   - revert `.agent-tile` bg   → the card-bg assertion fails
//   - leave text on --ct-color-fg → the text-flip assertion fails
//   - drop the focus outline    → the selected-border assertion fails
//   - re-add the stage bg       → the stage-folded-in assertion fails
// A future refactor that regressed the light card would be caught here rather
// than only surfacing in a manual reload.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("light whole-card background (86ca23utq)", () => {
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

  // Collect every rule body whose selector list contains `selectorLiteral` as a
  // token boundary (preceded by start / `,` / `{` / `}` / whitespace, so a
  // longer class like `.agent-tile--compact` does NOT match `.agent-tile`).
  function bodiesFor(selectorRegex: string): string[] {
    const re = new RegExp(
      `(?:^|[,{}\\s])${selectorRegex}\\s*\\{([^}]*)\\}`,
      "g",
    );
    return [...normalized.matchAll(re)].map((m) => m[1]);
  }

  describe("tokens", () => {
    it("defines --ct-card-bg in :root with a concrete value", () => {
      expect(normalized).toMatch(/--ct-card-bg:\s*[^;]+;/);
    });
    it("defines --ct-card-radius in :root", () => {
      expect(normalized).toMatch(/--ct-card-radius:\s*[^;]+;/);
    });
    it("defines the dark-on-light text + chrome tokens", () => {
      expect(normalized, "--ct-card-fg").toMatch(/--ct-card-fg:\s*[^;]+;/);
      expect(normalized, "--ct-card-fg-muted").toMatch(
        /--ct-card-fg-muted:\s*[^;]+;/,
      );
      expect(normalized, "--ct-card-hover").toMatch(
        /--ct-card-hover:\s*[^;]+;/,
      );
      expect(normalized, "--ct-card-hairline").toMatch(
        /--ct-card-hairline:\s*[^;]+;/,
      );
    });
  });

  describe(".agent-tile (the selected-border container)", () => {
    it("paints the light card-bg + a delineating border", () => {
      // `\.agent-tile` followed by a boundary that is NOT `-` (so the base rule,
      // not `.agent-tile--compact` or `.agent-tile[...]`, matches first).
      const base = bodiesFor("\\.agent-tile(?![-\\w])").find((b) =>
        /background-color:\s*var\(--ct-card-bg\)/.test(b),
      );
      expect(
        base,
        "no .agent-tile rule applies background-color: var(--ct-card-bg)",
      ).toBeDefined();
      // The hairline border is the light-theme delineation cue.
      expect(base!).toMatch(/border:\s*[^;]*var\(--ct-card-hairline\)/);
    });

    it("keeps the blue SELECTED/focus border (--ct-color-focus) on hover/focus", () => {
      const focusRuleBodies = [
        ...normalized.matchAll(
          /\.agent-tile:(?:hover|focus-visible)[^{}]*\{([^}]*)\}/g,
        ),
      ].map((m) => m[1]);
      const hasFocusBorder = focusRuleBodies.some((b) =>
        /outline:\s*1px solid var\(--ct-color-focus\)/.test(b),
      );
      expect(
        hasFocusBorder,
        "the blue selected/focus outline (--ct-color-focus) is missing",
      ).toBe(true);
    });
  });

  describe("card text flipped dark-on-light", () => {
    it(".agent-display uses --ct-card-fg (not the light default --ct-color-fg)", () => {
      const body = bodiesFor("\\.agent-display")[0];
      expect(body, "no .agent-display rule").toBeDefined();
      expect(body).toMatch(/color:\s*var\(--ct-card-fg\)/);
      expect(body).not.toMatch(/color:\s*var\(--ct-color-fg\)/);
    });
    it(".agent-role uses the muted dark --ct-card-fg-muted", () => {
      const body = bodiesFor("\\.agent-role")[0];
      expect(body, "no .agent-role rule").toBeDefined();
      expect(body).toMatch(/color:\s*var\(--ct-card-fg-muted\)/);
    });
  });

  describe("redundant sprite stage folded in", () => {
    it(".sprite-box no longer paints its own light background", () => {
      // The standalone `.sprite-box { ... }` rule (the one with width/height)
      // must NOT carry a background-color anymore — the whole card is light.
      const sizing = bodiesFor("\\.sprite-box").find((b) =>
        /width:\s*var\(--ct-sprite-size\)/.test(b),
      );
      expect(sizing, "no sizing .sprite-box rule found").toBeDefined();
      expect(
        sizing!,
        ".sprite-box still paints a background — stage should be folded into the card",
      ).not.toMatch(/background-color:/);
    });
  });
});
