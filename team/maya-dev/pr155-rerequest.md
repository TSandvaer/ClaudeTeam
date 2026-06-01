## Re-request review — Felix's REQUEST_CHANGES addressed (86ca23utq)

@Felix — pushed `389fff6`. All three findings fixed, plus a sweep + a regression test.

### Blocking fixes
- `.persona-instance-activity` (now dashboard.css:808): `var(--ct-color-fg)` → `var(--ct-card-fg)`.
- `.persona-instance-id` (now dashboard.css:799): `var(--ct-color-fg-muted)` → `var(--ct-card-fg-muted)`.

### NIT — kebab hover
- `.agent-tile-overflow-btn` REST fg → `var(--ct-card-fg-muted)` (the rest color is what shows the moment the tile-hover reveals the opacity-0 button).
- `.agent-tile-overflow-btn:hover` fg → `var(--ct-card-fg)` AND bg → `var(--ct-card-hover)` (the default translucent-WHITE `--ct-color-bg-hover` is invisible on #ECEFF1).

### Sweep for the bug CLASS
Grepped every `color: var(--ct-color-fg*)` in `dashboard.css` and classified by card-descendant status:
- **One additional sweep find recolored:** `.persona-instance-row:hover` bg `var(--ct-color-bg-hover)` → `var(--ct-card-hover)` (the row is an `.agent-tile` child — verified `multiAgentPersonaTile.ts:33` — so the translucent-white hover was invisible on the light card).
- **Confirmed NOT in scope (correctly left on `--ct-color-*`):** the background-agents chip (`.bg-agent-type/-description/-state/-model`, `.chip-header`) sits on the editor bg (dashed border, no `--ct-card-bg`); the overflow-menu items + remove-confirm panel carry their own `--vscode-menu-background` popover surface; session/team headers, empty-state, ct-hidden-members panel, and `.ct-monogram-chip` are all outside the card. The bug class is fully confined to `.agent-tile` / `.collapsed-persona-header` descendants.

### Test (catches the class)
`tests/unit/webview/cardBg.test.ts` gains a `card-descendant text + chrome read on the light card` describe (8 new assertions): each recolored selector must use a `--ct-card-*` token and must NOT match `--ct-color-fg*` / `--ct-color-bg-hover`. Mutation-checked: reverting `.persona-instance-activity` to `--ct-color-fg` fails exactly one test → non-vacuous. 13/13 in the file pass; full webview suite 577/577; typecheck clean; `npm run build` green.

Visual fidelity (the exact dark-on-light contrast feel) remains a sponsor post-merge gate per the sub-agent GUI-gap reframe — no reload claim here.
