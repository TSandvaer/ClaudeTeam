# M2 Dashboard Tile Spec — Webview Layout + Interaction

Spec for the ClaudeTeam VS Code extension webview dashboard. Visual and interaction contract for Maya's M2-05 implementation. Inherits M1-03 vocabulary; adds theme variables, click-to-drill, and all divergences introduced by the interactive webview context.

- **Ticket:** [ClickUp 86c9y7jf4](https://app.clickup.com/t/86c9y7jf4) — `spec(ux): M2 dashboard tile spec — webview layout + interaction`
- **Owner:** Iris
- **Peer reviewer:** Maya (visual)
- **Source docs:** `team/iris-ux/m1-cli-output-spec.md`, `.claude/docs/vscode-extension-conventions.md`, `.claude/docs/roster-matching.md`, `team/bram-research/m2-vscode-prior-art-2026-05-23.md`, `src/shared/types.ts`
- **Message types:** pending M2-01 merge — types sourced from `.claude/docs/vscode-extension-conventions.md` "Message protocol"; may be refined when `src/shared/messages.ts` lands.

---

## 1. Inherited vocabulary (unchanged from M1-03)

The following field names and state vocabulary carry over with zero change. Maya implements these verbatim from `src/shared/types.ts` — do NOT rename.

| Term | Definition | Source |
|---|---|---|
| `display` | `members[].display` from roster | `AgentTile.display` |
| `role` | `members[].role` from roster | `AgentTile.role` |
| `activity` | rendered activity string (full, no truncation) | `AgentTile.activity` |
| `model` | resolved model from subagent JSONL first assistant message | `AgentTile.model` |
| `state` | one of `running` / `idle` / `finished` / `error` | `AgentTile.state` |
| `background agent` | subagent that matched no roster member | `BackgroundAgent` |
| `session` | one `~/.claude/sessions/{pid}.json` entry | `SessionTree` |
| `agentId` | agent identifier used in the drill-in payload | `AgentTile.agentId` |
| `sessionId` | full session UUID | `SessionTree.sessionId` |

State glyphs (M1-03 §2) are also inherited — used in aria-labels and tooltips:

| State | Glyph (CLI) | Dashboard aria-label |
|---|---|---|
| `running` | `[>]` | "Running" |
| `idle` | `[.]` | "Idle" |
| `finished` | `[v]` | "Finished" |
| `error` | `[!]` | "Error" |

---

## 2. Divergences from M1-03 (AC2)

Five divergences. The first three are the minimum required per ticket AC2; two additional divergences were discovered during this spec pass.

### D1 — Wrap instead of truncate (activity field)

CLI: truncates `activity` with `..` at 30 chars.
Dashboard: wraps `activity` to a second line within the tile. The reducer stores the full string (`AgentTile.activity`); it is the presenter's job (M1-03 §5 divergence #2). Maya must NOT truncate — display the full string; the tile layout accommodates overflow via CSS `word-break: break-word`.

### D2 — Click-to-drill replaces one-shot print

CLI: no interaction. Prints the full detail list and exits.
Dashboard: rostered agent tiles are clickable. Clicking a tile fires `ui:open-transcript` to the extension host. The host opens the agent's JSONL in VS Code's native editor. See §6 (Interaction Contract) for the full message shape.

### D3 — Background chip collapses by default

CLI: always prints the full background detail list (there is no interaction model).
Dashboard: the background chip renders the count always visible; the detail list starts collapsed. Clicking the chip header toggles expanded/collapsed. This is a new UI state that exists only in the dashboard. See §5 (Background Chip) for the full spec.

### D4 — State indicator is a colored dot, not a bracketed glyph

CLI: state is a bracketed ASCII glyph (`[>]`, `[.]`, `[v]`, `[!]`). Monochrome.
Dashboard: state is a colored circular dot (`border-radius: 50%`; 10px diameter). Color is semantic hex (see §7 Design Tokens). The glyph characters are NOT rendered visually; they surface only as `aria-label` and `title` tooltip for accessibility. Reason: VS Code webview supports CSS; a colored dot communicates state faster at a glance than a bracketed character.

### D5 — Error UI is a named surface, not an exit code

CLI: on roster-read failure, prints empty state and exits 0.
Dashboard: roster errors and file-watcher errors render a visible error chip WITHIN the dashboard, never silently (see §8 Error UI). The extension keeps running; the user can see the error without leaving VS Code.

---

## 3. Dashboard layout overview (AC3)

The dashboard renders inside a `WebviewViewProvider` in the VS Code Activity Bar sidebar. Vanilla TypeScript (no React/Svelte) per M2-02 recommendation. All HTML must be CSP-safe — no inline event handlers, no inline `<style>` or `<script>` tags. Attach events with `element.addEventListener(...)`.

### 3.1 Outer structure wireframe

```
┌─────────────────────────────────┐
│  CLAUDETEAM DASHBOARD           │  ← panel header (VS Code renders this)
│  [Refresh]                      │  ← claudeteam.refresh command button
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐    │
│  │ SESSION 7b53d0ee         │    │  ← session-block (one per SessionTree)
│  │ cwd: c:\Trunk\...        │    │
│  │ title: ClaudeTeam M1    │    │
│  │                         │    │
│  │  ┌───────────────────┐  │    │
│  │  │ TEAM ClaudeTeam   │  │    │  ← team-card (one per team in session)
│  │  │ Alpha             │  │    │
│  │  │                   │  │    │
│  │  │  ┌─────────────┐  │  │    │
│  │  │  │ [>] Felix   │  │  │    │  ← agent tile (one per AgentTile)
│  │  │  │ Ext Host Dev│  │  │    │
│  │  │  │ tool:Edit   │  │  │    │
│  │  │  │ sonnet-4-5  │  │  │    │
│  │  │  └─────────────┘  │  │    │
│  │  │  ┌─────────────┐  │  │    │
│  │  │  │ [.] Maya    │  │  │    │
│  │  │  │ Webview Dev │  │  │    │
│  │  │  │ idle 14s    │  │  │    │
│  │  │  │ sonnet-4-5  │  │  │    │
│  │  │  └─────────────┘  │  │    │
│  │  └───────────────────┘  │    │
│  │                         │    │
│  │  ┌───────────────────┐  │    │  ← background chip (always visible)
│  │  │ + 3 background    │  │    │
│  │  │   [▶] expand      │  │    │
│  │  └───────────────────┘  │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │ SESSION a91f3c20 [dead]  │    │  ← dead session (lower-opacity treatment)
│  └─────────────────────────┘    │
│                                 │
└─────────────────────────────────┘

Theme variables applied at each zone:
  Panel background    → --vscode-editor-background
  Session block bg    → --vscode-sideBar-background (or fallback to editor-background)
  Session header text → --vscode-foreground
  Team card header    → --vscode-descriptionForeground
  Tile text           → --vscode-foreground
  Tile hover bg       → --vscode-list-hoverBackground
  Dead session text   → --vscode-disabledForeground (opacity: 0.5 fallback)
  Error chip bg       → --vscode-inputValidation-errorBackground
  Error chip border   → --vscode-inputValidation-errorBorder
  Error chip text     → --vscode-inputValidation-errorForeground
```

### 3.2 Empty state wireframe

Renders when `AgentTree.sessions` is empty OR every session is dead.

```
┌─────────────────────────────────┐
│  CLAUDETEAM DASHBOARD           │
│  [Refresh]                      │
├─────────────────────────────────┤
│                                 │
│  (no sessions icon / text)      │
│                                 │
│  No live Claude Code sessions.  │  ← --vscode-descriptionForeground
│                                 │
└─────────────────────────────────┘

Theme variable: --vscode-descriptionForeground
```

One line of text. No icon (icons-only is prohibited per design discipline). No decoration. The string is literal: `"No live Claude Code sessions."`. Same phrasing as M1-03 §1.7 for consistency.

---

## 4. Session block (AC1 — tile layout)

One session block per `SessionTree`. Blocks render in the order the reducer returns sessions.

```
┌────────────────────────────────────────────────┐
│ SESSION 7b53d0ee  [claude-vscode]  pid=68644   │  ← session-header
│ cwd:   c:\Trunk\PRIVATE\ClaudeTeam             │
│ title: ClaudeTeam M1 build session             │
│ state=alive                                    │  ← only shown when dead
├────────────────────────────────────────────────┤
│  [team card(s) here]                           │
│  [background chip here]                        │
└────────────────────────────────────────────────┘
```

**Session header DOM:**
```
<section class="session-block" data-session-id="{sessionId}" data-alive="{true|false}">
  <header class="session-header">
    <span class="session-id">SESSION {shortId}</span>
    <span class="session-entrypoint">[{entrypoint}]</span>
    <span class="session-pid">pid={pid}</span>
    <span class="session-cwd" title="{cwd}">{cwd}</span>
    <span class="session-title">{title}</span>
    <!-- only when !isAlive: -->
    <span class="session-dead-badge">dead</span>
  </header>
  [team cards]
  [background chip]
</section>
```

**Dead session treatment:** when `isAlive === false`, add class `session-block--dead` to the section. CSS applies `opacity: 0.5` and `color: var(--vscode-disabledForeground)`. No team cards render for dead sessions (consistent with M1-03 §3 note on dead session example). The session header still renders so the sponsor knows the session existed.

**Theme variables:**
- `--vscode-sideBar-background` — session block background (falls back to `--vscode-editor-background`)
- `--vscode-foreground` — session header text
- `--vscode-disabledForeground` — dead session text (with `opacity: 0.5` fallback if the variable is absent)

---

## 5. Agent tile (AC1a + AC1b)

### 5.1 Tile layout wireframe

The tile is the primary unit. Stacks four rows vertically within a fixed-width card column.

```
┌──────────────────────────────────────────────┐
│  ●  Felix                                    │
│     Extension Host Dev                       │
│     tool:Edit src/extension/watcher/...      │
│     sonnet-4-5                               │
└──────────────────────────────────────────────┘

Row 1: [state-dot]  [display name]
Row 2:              [role]
Row 3:              [activity]   (wraps if > line width — D1)
Row 4:              [model]
```

The state dot is on row 1, vertically centered with the display name. Rows 2–4 are indented to align with the display name (left-pad past the dot width).

### 5.2 Tile DOM

```html
<article class="agent-tile" data-state="{state}" data-agent-id="{agentId}" data-session-id="{sessionId}"
         role="button" tabindex="0"
         aria-label="{display} — {role} — {state}">
  <div class="tile-row tile-row--primary">
    <span class="state-dot" aria-label="{State}" title="{State}" data-state="{state}"></span>
    <span class="agent-display">{display}</span>
  </div>
  <div class="tile-row tile-row--role">
    <span class="agent-role">{role}</span>
  </div>
  <div class="tile-row tile-row--activity">
    <span class="agent-activity">{activity}</span>
  </div>
  <div class="tile-row tile-row--model">
    <span class="agent-model">{model}</span>
  </div>
</article>
```

Notes:
- `role="button"` + `tabindex="0"` — the tile is keyboard-navigable (Enter/Space trigger the same click handler as a mouse click).
- `data-state` on the `article` — lets CSS apply per-state styles without class toggling.
- `data-agent-id` + `data-session-id` — used by the click handler to construct the drill-in message payload. No JavaScript value lookup needed at click time.
- `aria-label` on the `state-dot` span + `title` — provides both screen-reader text and hover tooltip with the state word. No glyph text is rendered inside the span (the color carries the meaning visually; text carries it for accessibility).
- `agent-activity` text is NOT truncated. CSS: `word-break: break-word; white-space: normal`. (D1)

### 5.3 State indicator colors (AC1b, AC4)

The `.state-dot` is a 10×10px circle: `width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0`.

Color is applied via `data-state` attribute selector — NO class toggling:

```css
.state-dot[data-state="running"]  { background-color: #4caf50; }
.state-dot[data-state="idle"]     { background-color: #ffa726; }
.state-dot[data-state="finished"] { background-color: #78909c; }
.state-dot[data-state="error"]    { background-color: #ef5350; }
```

These four hex values are hardcoded — semantic meaning requires stable color. They do NOT use `--vscode-*` variables because the mapping is inherently semantic (green=running, amber=idle, grey=finished, red=error) and must remain stable across VS Code dark/light theme switches. Full token documentation in §7.

### 5.4 Tile hover state

```css
.agent-tile:hover,
.agent-tile:focus-visible {
  background-color: var(--vscode-list-hoverBackground);
  outline: 1px solid var(--vscode-focusBorder);
  cursor: pointer;
}
```

No transition/animation (out of scope, M4).

### 5.5 Child agent indentation

Per M1-03 §1.5, depth-1 subagents spawned by the orchestrator are the common case in V1. When parent→child nesting is present (linked via `toolUseId`), the child tile renders with `padding-left: 16px` additional indent inside the team card and a `┕` connector character (`&#x2515;`) prepended to its display name. Depth-2+ children flatten to depth-1 with `(nested)` appended to the `activity` field. This mirrors the CLI's nesting spec without requiring a tree layout algorithm.

---

## 6. Team card

One team card per team in `SessionTree.teamOrder`, rendered inside the session block.

```
┌────────────────────────────────────────────────┐
│ TEAM ClaudeTeam Alpha  (4 rostered)            │  ← team-header
│─────────────────────────────────────────────── │
│ [agent tile]                                   │
│ [agent tile]                                   │
│ [agent tile]                                   │
└────────────────────────────────────────────────┘
```

**Team card DOM:**
```html
<section class="team-card" data-team-id="{teamId}">
  <header class="team-header">
    <span class="team-name">TEAM {teamName}</span>
    <span class="team-count">({count} rostered)</span>
  </header>
  [agent tiles in roster order]
</section>
```

**Theme variables:**
- `--vscode-descriptionForeground` — team header text
- `--vscode-panel-border` — horizontal rule under team header (border-bottom)

Teams with zero matched members in a session are suppressed entirely (no empty team card). Same rule as M1-03 §1.3.

---

## 7. Background chip (AC1c)

### 7.1 Collapsed state (default)

```
┌────────────────────────────────────────────┐
│  + 3 background agents  [▶]               │  ← chip header (always visible)
└────────────────────────────────────────────┘
```

Count (`3`) is ALWAYS visible regardless of expanded/collapsed state. Per M1-03 §4 bullet 3 — hiding the count defeats the V1 thesis.

### 7.2 Expanded state (after click)

```
┌────────────────────────────────────────────┐
│  + 3 background agents  [▼]               │  ← chip header
│                                            │
│  • Explore                                 │
│    "Map MARIAN-TUTOR orchestration"        │
│    running  •  sonnet-4-5                  │
│                                            │
│  • general-purpose                         │
│    "Agent A — data sources"                │
│    running  •  sonnet-4-5                  │
│                                            │
│  • general-purpose                         │
│    "Agent B — limitations"                 │
│    finished  •  sonnet-4-5                 │
└────────────────────────────────────────────┘
```

Each background row shows: `agentType` label, `description` (full string, wraps), `state` (literal word), `model`. No click-to-drill on background rows in V1 (no `agentId` available for background agents in a meaningful way; V1 only drill-in for rostered tiles).

### 7.3 Background chip DOM

```html
<div class="background-chip" data-session-id="{sessionId}" data-expanded="false">
  <button class="chip-header" aria-expanded="false" aria-controls="bg-list-{sessionId}">
    <span class="chip-count">+ {count} background agents</span>
    <span class="chip-chevron" aria-hidden="true">▶</span>
  </button>
  <ul class="chip-detail-list" id="bg-list-{sessionId}" hidden>
    <!-- one <li> per BackgroundAgent -->
    <li class="bg-agent-row">
      <span class="bg-agent-type">{agentType}</span>
      <span class="bg-agent-description">"{description}"</span>
      <span class="bg-agent-state">{state}</span>
      <span class="bg-agent-model">{model}</span>
    </li>
  </ul>
</div>
```

**Toggle behavior:**
- Click on `.chip-header` → toggle `data-expanded` on `.background-chip`, toggle `hidden` on `.chip-detail-list`, flip `aria-expanded`, flip chevron `▶` → `▼`.
- No animation (M4). Toggle is instant: `hidden` attribute added/removed.
- The click handler is on the `<button>` element only (CSP-safe, attached via `addEventListener` in `main.ts`).

**Suppression:** if `background.length === 0`, do not render the chip (consistent with M1-03 §1.6 — no `+ 0 background agents` line).

**Theme variables:**
- `--vscode-descriptionForeground` — chip header text and detail row text
- `--vscode-list-hoverBackground` — chip header hover
- `--vscode-badge-background` — count badge background (optional — use if the VS Code theme defines it; fall back to no background)
- `--vscode-badge-foreground` — count badge foreground

---

## 8. Error UI (AC1e)

Two error subtypes from `roster-matching.md` "Loader edge cases": (A) malformed YAML, (B) file-watcher / runtime errors. Both render an error chip.

### 8.1 Malformed roster YAML

Triggered by `RosterLoadResult.errors.length > 0`. Renders at the TOP of the dashboard (above any session blocks), since it affects all rendering.

```
┌────────────────────────────────────────────┐
│  [!] Roster error                          │  ← error-chip-header
│  Could not load teams.yaml:                │
│  <parser error message>                    │  ← error detail (wraps)
│  [Open Roster File]                        │  ← button sends ui:open-roster
└────────────────────────────────────────────┘
```

Behavior: session blocks still render if sessions exist (fall back to "empty roster" mode per `roster-matching.md` — all agents go to background). The error chip persists until the next successful roster load.

**Roster warning (non-fatal):** `RosterLoadResult.warnings.length > 0` renders a softer warning chip using `--vscode-inputValidation-warningBackground` / Border / Foreground. Same layout; no "Open Roster File" button. Warning chip is dismissable (× button calls `dismiss` handler that hides the chip for the session — does NOT require a host message; purely webview-local ephemeral UI state).

### 8.2 File-watcher errors

Triggered by host sending `roster:error` message. Renders similarly to §8.1 but with text "File-watcher error" and the payload's `error` string as detail. No "Open Roster File" button (the error is not a roster-file problem).

### 8.3 Error chip DOM

```html
<div class="error-chip error-chip--error" role="alert" aria-live="polite">
  <span class="error-chip-icon" aria-hidden="true">!</span>
  <div class="error-chip-body">
    <span class="error-chip-title">Roster error</span>
    <span class="error-chip-detail">{error message}</span>
    <!-- only for malformed YAML: -->
    <button class="error-chip-action">Open Roster File</button>
  </div>
</div>
```

**Theme variables:**
- `--vscode-inputValidation-errorBackground`
- `--vscode-inputValidation-errorBorder`
- `--vscode-inputValidation-errorForeground`
- Warning variant: `--vscode-inputValidation-warningBackground`, `--vscode-inputValidation-warningBorder`, `--vscode-inputValidation-warningForeground`

**CSP note:** `role="alert"` + `aria-live="polite"` ensures screen readers announce error chips without requiring an imperative focus call.

---

## 9. Interaction contract (AC5)

All clickable elements attach event listeners in `main.ts` or a component module. No `onclick="..."` attributes (CSP violation).

| Element | Trigger | Message emitted | Host action |
|---|---|---|---|
| `.agent-tile` (rostered) | `click` or `keydown` Enter/Space | `{ type: "ui:open-transcript", payload: { sessionId: string, agentId: string } }` | `vscode.window.showTextDocument()` on the agent's JSONL path |
| `.chip-header` | `click` | none (webview-local state) | n/a — toggles chip expanded/collapsed |
| `.error-chip-action` ("Open Roster File") | `click` | `{ type: "ui:open-roster" }` | `vscode.window.showTextDocument()` on the roster YAML path |
| Refresh button | `click` | `{ type: "ui:refresh" }` | Immediately triggers one watcher tick |
| Background agent rows | none in V1 | none | n/a |
| Session header | none in V1 | none | n/a (team cards are always expanded in V1) |

**Message shape (pending M2-01):** types as documented in `.claude/docs/vscode-extension-conventions.md` "Message protocol":

```typescript
// Webview → Host (emitted by click handlers)
| { type: "ui:open-transcript"; payload: { sessionId: string; agentId: string } }
| { type: "ui:open-roster" }
| { type: "ui:refresh" }

// Host → Webview (received by messageReceiver.ts)
| { type: "state:full"; payload: DashboardState }
| { type: "state:delta"; payload: StateDelta }
| { type: "roster:loaded"; payload: { teams: Team[] } }
| { type: "roster:error"; payload: { error: string } }
```

**`acquireVsCodeApi()` usage:** called ONCE in `main.ts` at webview initialization. The returned `vscode` object is stored in a module-level variable and passed into click handlers. Calling it twice throws (per VS Code webview docs). When `acquireVsCodeApi` is undefined (browser dev mode), fall back to `console.log` mock — identical pattern to Pixel Agents' browser-mock fallback per M2-02.

**Keyboard navigation:** tiles are `tabindex="0"` and respond to Enter/Space via a `keydown` handler. Tab order follows DOM source order (session → team → tiles → chip header → next session). No custom focus management required in V1.

---

## 10. Design tokens (AC4)

### 10.1 CSS custom properties — VS Code theme variables

All of these resolve automatically when the webview page is rendered inside VS Code. If a variable is undefined (old VS Code version or unusual theme), the fallback value is used.

| Variable | Fallback | Usage |
|---|---|---|
| `--vscode-foreground` | `#cccccc` | Agent display name, role, model, session header text — all primary text |
| `--vscode-editor-background` | `#1e1e1e` | Dashboard panel background, outermost container |
| `--vscode-sideBar-background` | `--vscode-editor-background` | Session block background |
| `--vscode-list-hoverBackground` | `rgba(255,255,255,0.07)` | Tile hover state, chip header hover |
| `--vscode-descriptionForeground` | `#858585` | Team card header text, background chip text, session cwd/title text |
| `--vscode-panel-border` | `#444444` | Horizontal rule under team card header, session block border |
| `--vscode-focusBorder` | `#007fd4` | Focus outline on tiles and chip header (keyboard nav) |
| `--vscode-disabledForeground` | `rgba(204,204,204,0.5)` | Dead session text (when `isAlive === false`) |
| `--vscode-badge-background` | `#4d4d4d` | Background chip count badge background |
| `--vscode-badge-foreground` | `#ffffff` | Background chip count badge foreground |
| `--vscode-inputValidation-errorBackground` | `#5a1d1d` | Error chip background |
| `--vscode-inputValidation-errorBorder` | `#be1100` | Error chip border |
| `--vscode-inputValidation-errorForeground` | `#f48771` | Error chip text |
| `--vscode-inputValidation-warningBackground` | `#352a05` | Warning chip background |
| `--vscode-inputValidation-warningBorder` | `#cca700` | Warning chip border |
| `--vscode-inputValidation-warningForeground` | `#cca700` | Warning chip text |

### 10.2 Semantic state colors (hardcoded hex)

These four values do NOT use `--vscode-*` variables. Their semantic meaning (green=active, amber=paused, grey=done, red=broken) must survive theme switches unchanged.

| State | Hex | Usage | Element |
|---|---|---|---|
| `running` | `#4caf50` | State dot fill | `.state-dot[data-state="running"]` |
| `idle` | `#ffa726` | State dot fill | `.state-dot[data-state="idle"]` |
| `finished` | `#78909c` | State dot fill | `.state-dot[data-state="finished"]` |
| `error` | `#ef5350` | State dot fill | `.state-dot[data-state="error"]` |

Rationale for these specific hex values:
- `#4caf50` — Material Design Green 500. Universally legible on both dark and light VS Code themes without adjustment.
- `#ffa726` — Material Design Orange 400. Amber rather than yellow — avoids conflation with warning yellow, reads as "paused/waiting" not "danger."
- `#78909c` — Material Design Blue Grey 400. Neutral, de-emphasized — "done and gone."
- `#ef5350` — Material Design Red 400. Standard error red; slightly desaturated from pure #ff0000 to avoid eye strain on dark themes.

### 10.3 Spacing scale

Derived from VS Code's own sidebar component conventions (not a design-system dependency; just consistent numbers).

| Token | Value | Usage |
|---|---|---|
| `--ct-space-xs` | `4px` | Inner tile row gap |
| `--ct-space-s` | `8px` | Tile padding (all sides) |
| `--ct-space-m` | `12px` | Team card padding, chip padding |
| `--ct-space-l` | `16px` | Session block padding, child tile indent |
| `--ct-state-dot-size` | `10px` | State dot width + height |
| `--ct-state-dot-gap` | `8px` | Gap between state dot and display name |

These are `--ct-*` prefixed (ClaudeTeam namespace) to avoid collision with VS Code internal variables. Maya defines them in `src/webview/styles/dashboard.css` at `:root`.

### 10.4 Typography

No custom fonts. The webview inherits VS Code's own `--vscode-font-family`, `--vscode-font-size`, `--vscode-font-weight`. Apply to `:root` or `body`:

```css
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background-color: var(--vscode-editor-background);
}
```

Agent model text: `font-size: smaller` (one step below body). Session cwd and title: `--vscode-descriptionForeground` at normal size. No custom font weights.

---

## 11. Open questions surfaced for Felix / Maya

1. **`DashboardState` type shape** — `src/shared/types.ts` defines `AgentTree` (with `sessions: SessionTree[]`); the webview message protocol uses `DashboardState`. If these are the same type, Felix should alias or re-export. If they differ, Felix should document the delta when wiring `messageBus.ts` in M2-06. The spec uses `AgentTree` / `SessionTree` as the assumed payload shape.

2. **`StateDelta` type** — not yet defined in `src/shared/types.ts`. Required for `state:delta` messages (M2-05 AC7). Felix should define the delta shape in M2-01 / M2-04; Maya should not invent one. If undefined when M2-05 starts, Maya implements full-replace only and files a follow-up.

3. **Background agent `agentId`** — `BackgroundAgent` in `types.ts` has no `agentId` field. This is intentional for V1 (no drill-in for background agents, per §9). If a future ticket adds background drill-in, Felix must add `agentId?: string` to `BackgroundAgent`. Flagged here so Felix is aware the spec intentionally omits it.

4. **Roster member `color` field** — `Member.color` in `types.ts` is optional (`color?: string`). The spec does not currently use the per-member color for tile backgrounds (the state dot provides state color; the tile background is always `--vscode-editor-background`). If Thomas wants per-member accent colors on tile cards in M3, the field is already in the type. No action needed in M2.

5. **`teams.yaml` file path for `ui:open-roster`** — the host handler for `ui:open-roster` needs to know which roster file was loaded (global vs project). Felix should expose the loaded roster path from the loader in M2-04/M2-06 so the host can pass it to `showTextDocument`. The spec assumes the host has this; implementation detail for Felix.

---

## 12. Dashboard-tile done-when (AC6)

Maya's M2-05 Self-Test Report must document the following observable behaviors. Each is a testable assertion, not a vague claim.

### 12.1 Tile renders correctly

- **Verify:** Install VSIX in VS Code. Open ClaudeTeam Activity Bar view. Confirm one tile renders per rostered agent in `FIXTURE_STATE` (all six personas from `src/shared/fixtures.ts`).
- **Evidence:** Screenshot of the dashboard in static-fixture mode showing all four agent states (`running`, `idle`, `finished`, `error`).

### 12.2 State indicator updates on poll

- **Verify:** With live data wired (M2-06), change the state of a subagent (e.g. let it finish). Confirm the dot color changes from `#4caf50` to `#78909c` within ~4 seconds (one poll cycle).
- **Evidence:** Two screenshots or a screen recording showing the before/after dot color change. (M2-05 can defer this to M2-06's Self-Test Report if live data is not wired at M2-05.)

### 12.3 Background chip collapses / expands on click

- **Verify:** Click the chip header. Detail list appears. Click again. Detail list disappears. Count remains visible in both states.
- **Evidence:** Screenshots of collapsed state and expanded state for the same chip.

### 12.4 Drill-in opens JSONL in VS Code editor

- **Verify:** Click a rostered agent tile. A `ui:open-transcript` message fires (confirmed via Output channel log from the host handler). The JSONL file opens in a VS Code editor tab.
- **Evidence:** Screenshot of the editor tab showing the JSONL file. Output channel log excerpt showing `ui:open-transcript` received with correct `sessionId` + `agentId`. (Deferred to M2-06 if not wired in M2-05.)

### 12.5 Theme-switch leaves no broken styling

- **Verify:** With the dashboard visible, toggle VS Code theme: Light → Dark → High Contrast. In each theme: (a) tile text remains readable; (b) state dots remain visible with correct colors; (c) no hardcoded-color artifacts appear (e.g. white text on white background).
- **Evidence:** Screenshots in Dark and Light themes. High Contrast if time permits.

### 12.6 Empty state renders

- **Verify:** Modify the static fixture to return an empty sessions array, or close all Claude Code sessions in a live run. Confirm the dashboard shows "No live Claude Code sessions." and nothing else (no broken layout artifacts, no blank white area).
- **Evidence:** Screenshot.

### 12.7 Error UI renders

- **Verify:** Trigger a `roster:error` message (send one manually via the extension's test harness, or corrupt `teams.yaml`). Confirm the error chip appears at the top of the dashboard with the error text.
- **Evidence:** Screenshot showing the error chip.

### 12.8 Keyboard navigation works

- **Verify:** Tab through the dashboard without a mouse. Confirm: (a) each tile is reachable via Tab; (b) focused tile has a visible focus ring; (c) Enter/Space on a focused tile triggers `ui:open-transcript`.
- **Evidence:** Screenshot showing focus ring on a tile.

---

## 13. CSP compliance notes (for Maya)

Per `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"Webview CSP" and `.claude/docs/vscode-extension-conventions.md` "Webview rules":

- All CSS goes in `src/webview/styles/dashboard.css`, loaded via `<link rel="stylesheet" href="{bundleUri}">`. No `<style>` tags in HTML.
- All JS goes in the bundled `dist/webview/main.js`, loaded via `<script src="{bundleUri}">`. No `<script>` inline tags.
- No `onclick="..."`, `onmouseenter="..."`, or other inline event handler attributes. ALL event listeners attached via `element.addEventListener(...)` in TypeScript.
- The recommended CSP for `provider.ts` (from M2-02 research):
  ```
  default-src 'none';
  img-src ${webview.cspSource};
  script-src ${webview.cspSource};
  style-src ${webview.cspSource};
  ```
- Pixel Agents' no-CSP pattern is an explicit anti-pattern. ClaudeTeam renders user-controlled data (agent descriptions, JSONL paths) — CSP is load-bearing.

---

*Spec authored against M1-03 vocabulary, `src/shared/types.ts` (current main), and M2-02 framework decisions. Pending M2-01 merge for final message type confirmation.*
