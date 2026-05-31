// Source-derived guard for the HERO-CHARACTER card layout (86ca2522v).
//
// Iris's hero-layout spec re-flows the agent card from a 2-column grid (sprite
// left, text stacked right) into a 3-ZONE VERTICAL stack: a top meta bar, a
// large CENTERED hero sprite, and a bottom meta bar. This is a CSS-ONLY re-flow
// of the EXISTING markup — no `.ts` edit — so the contract is entirely in
// `dashboard.css` and is headlessly assertable from the CSS text. The visual
// fidelity (how big the hero FEELS, exact slope, theme contrast) is sponsor-
// gated per the sub-agent GUI-gap reframe; what this test pins is the STRUCTURAL
// contract that makes the layout correct + complete:
//
//   1. The hero sizing is in TOKENS — `:root` defines `--ct-sprite-size` plus
//      the three live-tunable sub-tokens (`--ct-sprite-size-min/-max`,
//      `--ct-sprite-grow`) so the sponsor tweaks floor / slope / cap on a reload.
//   2. `.session-block` is an inline-size query container (`container-type` +
//      `container-name: ct-panel`) so the hero scales with the panel drag-width.
//   3. `.agent-tile[data-has-sprite="true"]` is a 3-zone grid with the named
//      `grid-template-areas` (name|role / hero / model|activity), NOT the old
//      2-column `grid-template-columns: var(--ct-sprite-size) 1fr`.
//   4. Each existing child is re-placed into its zone via `grid-area`
//      (sprite-box → hero, primary → name, role → role, model → model,
//      activity → activity), and the hero sprite is `justify-self: center`.
//   5. The row indent (padding-left past the dot) is ZEROED inside the hero
//      scope — rows are now in their own cells, not stacked under the dot.
//   6. An `@container ct-panel` rule redefines `--ct-sprite-size` to a clamp()
//      of the three sub-tokens — the single-lever continuous scaling.
//   7. `image-rendering: pixelated` stays on `.sprite-frame` (crispness at any
//      clamp ratio).
//
// Non-vacuity: reverting ANY of these edits makes a `describe` fail —
//   - drop a sub-token                       → token-existence assertion fails
//   - drop container-type/name on .session-block → container assertion fails
//   - revert to grid-template-columns 2-col  → grid-template-areas assertion fails
//   - drop a grid-area placement             → that placement assertion fails
//   - re-add the indent in hero scope        → the indent-reset assertion fails
//   - drop the @container clamp redefinition → the scaling assertion fails
// A future refactor that regressed the hero layout would be caught here rather
// than only surfacing in a manual reload.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("hero-character card layout (86ca2522v)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..");
  const css = readFileSync(
    join(root, "src", "webview", "styles", "dashboard.css"),
    "utf8",
  );
  // Strip comments + collapse whitespace so assertions tolerate reformats.
  const normalized = css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");

  // Collect every rule body whose selector list contains `selectorRegex` as a
  // token boundary (preceded by start / `,` / `{` / `}` / whitespace).
  function bodiesFor(selectorRegex: string): string[] {
    const re = new RegExp(
      `(?:^|[,{}\\s])${selectorRegex}\\s*\\{([^}]*)\\}`,
      "g",
    );
    return [...normalized.matchAll(re)].map((m) => m[1]);
  }

  // Find the single rule body matching `selectorRegex` exactly; assert it exists.
  function oneBody(selectorRegex: string, label: string): string {
    const bodies = bodiesFor(selectorRegex);
    expect(bodies.length, `no rule for ${label}`).toBeGreaterThan(0);
    return bodies.join(" ");
  }

  describe("hero sizing tokens (live-tunable)", () => {
    it("defines --ct-sprite-size with a concrete value", () => {
      expect(normalized).toMatch(/--ct-sprite-size:\s*[^;]+;/);
    });
    it("defines the three sub-tokens (floor / slope / cap)", () => {
      expect(normalized, "--ct-sprite-size-min").toMatch(
        /--ct-sprite-size-min:\s*[^;]+;/,
      );
      expect(normalized, "--ct-sprite-size-max").toMatch(
        /--ct-sprite-size-max:\s*[^;]+;/,
      );
      expect(normalized, "--ct-sprite-grow").toMatch(
        /--ct-sprite-grow:\s*[^;]+;/,
      );
    });
    it("the grow/slope sub-token uses a container-query unit (cqw)", () => {
      const m = normalized.match(/--ct-sprite-grow:\s*([^;]+);/);
      expect(m, "--ct-sprite-grow not defined").not.toBeNull();
      expect(
        m![1],
        "--ct-sprite-grow must use a cqw container-query unit so the hero scales with the panel",
      ).toMatch(/cqw/);
    });
    it("the hero baseline is large (>= 120px), not the old 68px tile", () => {
      const m = normalized.match(/--ct-sprite-size:\s*(\d+)px\s*;/);
      expect(m, "--ct-sprite-size base px not defined").not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(120);
    });
  });

  describe(".session-block is a query container", () => {
    it("declares container-type: inline-size + container-name: ct-panel", () => {
      const body = oneBody("\\.session-block(?![-\\w])", ".session-block");
      expect(body, "container-type missing").toMatch(
        /container-type:\s*inline-size/,
      );
      expect(body, "container-name: ct-panel missing").toMatch(
        /container-name:\s*ct-panel/,
      );
    });
  });

  describe(".agent-tile[data-has-sprite] is a 3-zone hero grid", () => {
    // The base hero-grid rule body (display:grid + grid-template-areas).
    const heroBody = bodiesFor(
      '\\.agent-tile\\[data-has-sprite="true"\\]',
    ).find((b) => /grid-template-areas/.test(b));

    it("is display:grid", () => {
      expect(heroBody, "no hero grid rule found").toBeDefined();
      expect(heroBody!).toMatch(/display:\s*grid/);
    });

    it("uses named grid-template-areas (name|role / hero / model|activity)", () => {
      expect(heroBody!).toMatch(/grid-template-areas:/);
      // Normalize quotes/whitespace inside the areas value.
      const areas = heroBody!.match(/grid-template-areas:\s*([^;]+);/);
      expect(areas, "grid-template-areas value not captured").not.toBeNull();
      const flat = areas![1].replace(/["']/g, " ").replace(/\s+/g, " ").trim();
      expect(flat, "Zone A name|role row missing").toMatch(/name\s+role/);
      expect(flat, "Zone B hero row missing").toMatch(/hero\s+hero/);
      expect(flat, "Zone C model|activity row missing").toMatch(
        /model\s+activity/,
      );
    });

    it("does NOT keep the old 2-column grid-template-columns: var(--ct-sprite-size) 1fr", () => {
      // The hero rule replaces the 2-column template. Guard against a revert
      // that re-introduces the sprite-size column.
      expect(
        heroBody!,
        "hero grid still declares the old 2-column sprite-size template",
      ).not.toMatch(/grid-template-columns:\s*var\(--ct-sprite-size\)\s+1fr/);
    });
  });

  describe("each existing child is re-placed into its zone", () => {
    function placement(childSelector: string, label: string): string {
      const bodies = bodiesFor(
        `\\.agent-tile\\[data-has-sprite="true"\\]\\s*>\\s*${childSelector}`,
      );
      expect(bodies.length, `no placement rule for ${label}`).toBeGreaterThan(0);
      return bodies.join(" ");
    }

    it("sprite-box → hero area, centered", () => {
      const body = placement("\\.sprite-box", "sprite-box");
      expect(body).toMatch(/grid-area:\s*hero/);
      expect(body, "hero sprite must be horizontally centered").toMatch(
        /justify-self:\s*center/,
      );
    });
    it("tile-row--primary → name area", () => {
      expect(placement("\\.tile-row--primary", "primary")).toMatch(
        /grid-area:\s*name/,
      );
    });
    it("tile-row--role → role area", () => {
      expect(placement("\\.tile-row--role", "role")).toMatch(
        /grid-area:\s*role/,
      );
    });
    it("tile-row--model → model area", () => {
      expect(placement("\\.tile-row--model", "model")).toMatch(
        /grid-area:\s*model/,
      );
    });
    it("tile-row--activity → activity area", () => {
      expect(placement("\\.tile-row--activity", "activity")).toMatch(
        /grid-area:\s*activity/,
      );
    });
    it("persona-instances spans full width below the explicit zones", () => {
      const body = placement("\\.persona-instances", "persona-instances");
      expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    });
  });

  describe("hero-scope indent reset (design spec §2.3)", () => {
    it("zeroes padding-left on rows 2-4 inside the hero scope", () => {
      // Find a hero-scoped rule listing role/activity/model that sets
      // padding-left: 0 (the rows are no longer stacked under the dot).
      const re =
        /\.agent-tile\[data-has-sprite="true"\][^{}]*\.tile-row--(?:role|activity|model)[^{}]*\{([^}]*)\}/g;
      const bodies = [...normalized.matchAll(re)].map((m) => m[1]);
      const hasReset = bodies.some((b) => /padding-left:\s*0\b/.test(b));
      expect(
        hasReset,
        "hero scope must zero the row indent (padding-left: 0) — rows are in their own cells now",
      ).toBe(true);
    });
  });

  describe("continuous scaling via @container", () => {
    it("an @container ct-panel rule redefines --ct-sprite-size to a clamp()", () => {
      // Capture the @container block body (greedy to the matching closing brace
      // is hard with a flat regex; assert on the clamp redefinition co-located
      // with the container query keyword + the hero selector).
      expect(
        normalized,
        "@container ct-panel query missing",
      ).toMatch(/@container\s+ct-panel/);
      // The token is redefined to a clamp of the three sub-tokens.
      expect(
        normalized,
        "--ct-sprite-size is not redefined to a clamp() of the sub-tokens",
      ).toMatch(
        /--ct-sprite-size:\s*clamp\(\s*var\(--ct-sprite-size-min\)\s*,\s*var\(--ct-sprite-grow\)\s*,\s*var\(--ct-sprite-size-max\)\s*\)/,
      );
    });
  });

  describe("pixel crispness preserved", () => {
    it("keeps image-rendering: pixelated on .sprite-frame", () => {
      const body = oneBody("\\.sprite-frame(?![-\\w])", ".sprite-frame");
      expect(body).toMatch(/image-rendering:\s*pixelated/);
    });
  });
});
