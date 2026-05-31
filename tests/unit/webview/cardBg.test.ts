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

  // ──────────────────────────────────────────────────────────────────────────
  // Card-CONTAINER hover stays LIGHT (86ca23utq dark-on-hover fix).
  //
  // Bug: `--ct-card-hover` was a translucent-DARK token (`rgba(0,0,0,0.06)`). The
  // card-CONTAINER hover selectors (`.agent-tile:hover`,
  // `.collapsed-persona-header:hover`) apply it as `background-color`, REPLACING
  // the light `--ct-card-bg` (#ECEFF1). A translucent rgba(0,0,0,α) there
  // composites over the DARK editor bg behind the tile → the card reads as turning
  // dark on hover. Fix: `--ct-card-hover` is a SOLID light hex (a gentle darkening
  // of #ECEFF1) so the hovered card stays light, deterministically.
  //
  // Non-vacuity: reverting `--ct-card-hover` to `rgba(0, 0, 0, 0.06)` (or any
  // translucent-dark / non-hex value) flips both the solid-hex assertion AND the
  // no-translucent-dark assertion to failures.
  describe("card-container hover stays light (86ca23utq dark-on-hover fix)", () => {
    function cardHoverValue(): string {
      const m = normalized.match(/--ct-card-hover:\s*([^;]+);/);
      expect(m, "--ct-card-hover token not defined").not.toBeNull();
      return m![1].trim();
    }

    it("--ct-card-hover resolves to a SOLID light hex, not a translucent token", () => {
      const value = cardHoverValue();
      // Solid 3- or 6-digit hex only — no rgba()/hsla()/named alpha forms.
      expect(
        value,
        `--ct-card-hover must be a solid hex (got "${value}")`,
      ).toMatch(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    });

    it("--ct-card-hover is NOT a translucent-dark rgba(0,0,0,...) tint", () => {
      const value = cardHoverValue();
      expect(
        value,
        "--ct-card-hover is a translucent-dark tint — composites dark over the editor bg behind the card",
      ).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/i);
      // Belt-and-suspenders: forbid any alpha-channel form as the card-container
      // background (an rgba/hsla there always composites over what's behind).
      expect(value).not.toMatch(/rgba|hsla/i);
    });

    it("--ct-card-hover is a LIGHT value (channels high → stays a light card)", () => {
      const value = cardHoverValue();
      const hex = value.replace("#", "");
      const full =
        hex.length === 3
          ? hex
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      // A "light tint" of #ECEFF1 keeps every channel high; a dark token (the bug)
      // would have low channels. Floor well above mid-grey.
      for (const [name, ch] of [
        ["r", r],
        ["g", g],
        ["b", b],
      ] as const) {
        expect(ch, `--ct-card-hover channel ${name} too dark (${ch})`).toBeGreaterThan(
          180,
        );
      }
    });

    const containerHoverSelectors: ReadonlyArray<string> = [
      "\\.agent-tile:(?:hover|focus-visible)",
      "\\.collapsed-persona-header:(?:hover|focus-visible)",
    ];
    for (const selector of containerHoverSelectors) {
      it(`${selector.replace(/\\\\/g, "")} consumes the (now-solid-light) --ct-card-hover bg`, () => {
        const bodies = [
          ...normalized.matchAll(
            new RegExp(`${selector}[^{}]*\\{([^}]*)\\}`, "g"),
          ),
        ].map((m) => m[1]);
        expect(bodies.length, `no rule for ${selector}`).toBeGreaterThan(0);
        const hasCardHover = bodies.some((b) =>
          /background-color:\s*var\(--ct-card-hover\)/.test(b),
        );
        expect(
          hasCardHover,
          `${selector} does not apply background-color: var(--ct-card-hover)`,
        ).toBe(true);
      });
    }
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

  // ──────────────────────────────────────────────────────────────────────────
  // Card-DESCENDANT text + chrome must read on the light card (Felix REQUEST_
  // CHANGES on PR #155, 86ca23utq). The whole-card flip (above) covered
  // `.agent-tile` itself + the primary text rows (`.agent-display`/`.agent-role`),
  // but TWO multi-agent-persona-tile descendants + the kebab were left on the
  // LIGHT `--ct-color-*` tokens → light-on-light on #ECEFF1 (a legibility bug).
  //
  // These selectors all render INSIDE `.agent-tile` (verified:
  // multiAgentPersonaTile.ts line 33 nests `.persona-instance-row` /
  // `.persona-instance-id` / `.persona-instance-activity` under
  // `<article class="agent-tile">`; the kebab `.agent-tile-overflow-btn` is a
  // transparent `.agent-tile` child so the card bg shows through). On the light
  // card their fg MUST resolve to a `--ct-card-*` token, and their hover bg must
  // use the translucent-DARK `--ct-card-hover` (the default translucent-WHITE
  // `--ct-color-bg-hover` is invisible on #ECEFF1).
  //
  // Non-vacuity: reverting ANY recolor (e.g. `.persona-instance-activity` back to
  // `var(--ct-color-fg)`, or the kebab hover back to `var(--ct-color-fg)` /
  // `var(--ct-color-bg-hover)`) flips a `.not.toMatch(/--ct-color-/)` assertion to
  // a failure. This is the test that would have caught Felix's two findings + the
  // kebab NIT before review.
  describe("card-descendant text + chrome read on the light card", () => {
    // fg-token selectors: rule body must use a --ct-card-* color and must NOT
    // fall back to any --ct-color-* foreground/hover token.
    const fgSelectors: ReadonlyArray<[string, RegExp]> = [
      // [selectorRegex, the --ct-card-* token its `color:` must use]
      ["\\.persona-instance-activity", /color:\s*var\(--ct-card-fg\)/],
      ["\\.persona-instance-id", /color:\s*var\(--ct-card-fg-muted\)/],
      // kebab REST fg (visible the moment the tile-hover reveals the button).
      [
        "\\.agent-tile-overflow-btn(?![-:\\w])",
        /color:\s*var\(--ct-card-fg-muted\)/,
      ],
    ];

    for (const [selector, cardToken] of fgSelectors) {
      it(`${selector.replace(/\\\\/g, "")} uses a --ct-card-* fg, not --ct-color-*`, () => {
        const body = bodiesFor(selector)[0];
        expect(body, `no rule for ${selector}`).toBeDefined();
        expect(body!).toMatch(cardToken);
        // The bug class: ANY light-token foreground on a card descendant.
        expect(
          body!,
          `${selector} still uses a light --ct-color-* foreground on the light card`,
        ).not.toMatch(/color:\s*var\(--ct-color-fg(?:-muted)?\)/);
      });
    }

    it(".agent-tile-overflow-btn:hover recolors fg + bg for the light card", () => {
      const hover = [
        ...normalized.matchAll(
          /\.agent-tile-overflow-btn:hover\s*\{([^}]*)\}/g,
        ),
      ].map((m) => m[1]);
      expect(hover.length, "no .agent-tile-overflow-btn:hover rule").toBeGreaterThan(0);
      const body = hover[0];
      expect(body).toMatch(/color:\s*var\(--ct-card-fg\)/);
      expect(body).toMatch(/background-color:\s*var\(--ct-card-hover\)/);
      expect(
        body,
        "kebab hover still uses light --ct-color-* fg/hover on the light card",
      ).not.toMatch(/var\(--ct-color-(?:fg(?:-muted)?|bg-hover)\)/);
    });

    it(".persona-instance-row:hover uses the translucent-dark card hover", () => {
      const hover = [
        ...normalized.matchAll(
          /\.persona-instance-row:(?:hover|focus-visible)[^{}]*\{([^}]*)\}/g,
        ),
      ].map((m) => m[1]);
      expect(hover.length, "no .persona-instance-row:hover rule").toBeGreaterThan(0);
      const body = hover[0];
      expect(body).toMatch(/background-color:\s*var\(--ct-card-hover\)/);
      expect(
        body,
        "persona-instance-row hover still uses the invisible translucent-white --ct-color-bg-hover",
      ).not.toMatch(/background-color:\s*var\(--ct-color-bg-hover\)/);
    });
  });
});
