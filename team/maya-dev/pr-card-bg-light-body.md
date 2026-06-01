# feat(webview): light WHOLE-CARD background for agent tiles (86ca23utq)

> **PIVOT (2026-05-31):** supersedes the stage-only implementation on this same PR.
> Sponsor previewed the stage-only build (light bg behind ONLY the sprite) and
> asked: *"I think it would look better if the whole agent container had the light
> color (the one that has a blue border when selected)."* This force-push moves the
> light background from `.sprite-box` to the entire agent **card** (the container that
> takes the blue selected/focus border) and flips all card text + chrome dark-on-light.
> The stage-only design (Iris spec §2 Option B) is replaced by the whole-tile-light
> fallback (Iris spec §5 Option A).

## What changed

All in `src/webview/styles/dashboard.css` (CSS-only; no markup, no host/data change).

### 1. Tokens (`:root`)
- **`--ct-card-bg: #ECEFF1`** (was `--ct-sprite-stage-bg`) — Material Blue-Grey 50, sponsor-picked. **Hardcoded hex** (same no-theme exemption as the semantic state colors) so the card stays light in BOTH dark and light VS Code themes. Kept in a token so the sponsor can tweak the exact hex live.
- **`--ct-card-radius: var(--ct-radius-tile)`** (was `--ct-sprite-stage-radius`).
- **Dark-on-light text/chrome tokens** (values + contrast ratios from Iris spec §5, measured against `#ECEFF1`):
  - `--ct-card-fg: #1f2933` — near-black slate, ≈ 13:1 (AA/AAA) — member name, activity line.
  - `--ct-card-fg-muted: #52606d` — slate-grey, ≈ 6:1 (AA) — role, model, count text, status hint.
  - `--ct-card-hover: rgba(0,0,0,0.06)` — translucent-DARK hover (the default translucent-white is invisible on light).
  - `--ct-card-hairline: rgba(0,0,0,0.12)` — delineating border, load-bearing in a LIGHT theme where card and editor bg are tonally close.

### 2. The card container — `.agent-tile` (the selected-border element)
- Now paints `background-color: var(--ct-card-bg)` + `border: 1px solid var(--ct-card-hairline)`.
- **Blue SELECTED border kept exactly:** `.agent-tile:hover, :focus-visible { outline: 1px solid var(--ct-color-focus) }` unchanged. Hover bg swapped to `--ct-card-hover` so it reads on light.
- The multi-agent persona tile (`multiAgentPersonaTile.ts`) and the collapsed compact instance rows (`collapsedPersonaTile.ts`) both render as `.agent-tile`, so they inherit the light card automatically.
- **`.collapsed-persona-header`** (the multi-agent cluster's card root — same chrome + blue focus border) given the matching light bg + hairline + dark text.

### 3. Text + chrome flipped dark-on-light
Recolored to the dark tokens: member **name** (`.agent-display`), **role** (`.agent-role`), **activity/status line** `idle 1255s` / `finished` / `available` (`.agent-activity`), **model line** `claude-opus-4-8` (`.agent-model`), the **`(N agents)` count** (`.persona-count-hint`), the **`×N` badge** (`.persona-count-badge` + chevron), the collapsed-persona **name/chevron/status-hint**.
- **Status dot** default fill → `--ct-card-fg-muted` (the four `[data-state]` semantic hex — running `#4caf50` / idle `#ffa726` / finished `#78909c` / error `#ef5350` / available `#90a4ae` — all pass ≥3:1 on `#ECEFF1` per spec §5, so they're untouched and the dark fallback only paints the rare no-state dot).
- **Finished-check stroke** re-pointed from `--ct-color-bg-editor` (which inverts to LIGHT under a light theme and would vanish on the grey finished dot) to the dark `--ct-card-fg`, so the check contrasts the mid-grey dot in BOTH themes.

### 4. Sprite stage folded in
`.sprite-box` no longer paints its own light panel — the whole card is light, so a separate stage would double-paint. The sprite sits directly on the lit card. No subtle inset kept (the card hairline already delineates; an inner panel on a same-color card adds nothing).

## Theme safety
- Card bg + all flipped text/chrome are **hardcoded** (not `var(--vscode-*)`) → identical light card in dark AND light themes; no light-grey-on-light failure.
- In a LIGHT VS Code theme (card ≈ editor bg), the **`--ct-card-hairline` border + the blue focus outline** delineate the card so it doesn't dissolve into the background.

## Tests
- `tests/unit/webview/cardBg.test.ts` (renamed from `spriteStageBg.test.ts`, 8 tests) — source-derived structural guard: tokens defined; `.agent-tile` consumes `--ct-card-bg` + hairline; **card text consumes the DARK `--ct-card-fg`/`-muted`, NOT the light `--ct-color-fg`**; blue focus border retained; sprite stage folded in.
- **Non-vacuity mutation-checked:** reverting `.agent-tile` bg → dark fails the card-bg test; un-flipping card text (`--ct-card-fg` → `--ct-color-fg`) fails the text-flip test. Both restored.
- Full suite: 1130 unit pass (2 skipped), typecheck clean, `npm run build` green.

## Self-Test Report
See the Self-Test Report comment below.

## Open design questions (sponsor)
1. **Exact text hex** — used spec §5's `#1f2933` (name/activity) + `#52606d` (role/model/count). If too hard / too soft, tweak the two `--ct-card-*-fg*` tokens (one line each).
2. **Card hex** — `#ECEFF1`; tweak `--ct-card-bg` to `#FFFFFF` (max pop) or `#F5F1E8` (warm paper).
3. **Compact instance rows** — the expanded `.agent-tile--compact` instance rows under a multi-agent header are ALSO light cards (they're `.agent-tile` elements with the blue focus border). Reads as a coherent light cluster; flag if you'd prefer them to stay on the dark surface as indented detail rows.
