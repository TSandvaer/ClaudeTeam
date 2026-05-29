# Team-Setup UX Spec (TS-01)

**Ticket:** TS-01 `86ca1mw0w` — epic gate. TS-02/03/04 depend on this spec.
**Source of truth:** `team/nora-pl/team-setup-epic-backlog.md` (7 LOCKED decisions + LOCKED Vocabulary contract + ratify-on-return items).
**Reviewer:** orchestrator-direct (design spec) + Maya peer (visuals).

This spec covers the full UX surface of the team-setup epic — detection trichotomy, setup wizard, Manage Team panel, character picker, suggest-setup affordance, empty state, orphan/stale tiles, and the orchestrator-not-a-tile constraint — and decomposes the file surface into parallel-safe **Felix-zone (host)** vs **Maya-zone (webview)** ownership so Wave-1/2 dispatch does not collide.

All identifiers referenced by name are LOCKED in the backlog Vocabulary contract: `ClaudeTeamConfig`, `ScannedAgent`, `MemberCharacter` / `Member.character`, `CharacterSource`, `MemberStatus`, `SetupDetectionState`, and the `setup:*` / `ui:*` messages. This spec does NOT introduce new identifiers — it specifies the UX those identifiers drive.

**Design discipline (CLAUDE.md):** theme-aware first (`--vscode-*` + existing `--ct-*` tokens — no new color tokens); no icons-only (every icon paired with text/aria-label); honor existing tokens (`--ct-color-state-*`, `--ct-radius-tile`, monogram-chip fallback from `whole-team-display-spec.md`).

---

## 0. AC → section map

| AC | Section |
|---|---|
| AC1 — three `SetupDetectionState` renders + EXACT empty-state copy | §2 |
| AC2 — setup wizard end-to-end (scan → curate → preview → confirm → first render) | §3 |
| AC3 — Manage Team panel (edit fields, character-picker grid, assign/clear, merge, reopen) | §4, §5 |
| AC4 — four ratify-on-return items as `PROPOSAL — sponsor ratify` | §7 |
| AC5 — Felix-zone vs Maya-zone decomposition + Vocabulary-contract references | §8 |
| AC6 — orphan/stale visual + orchestrator-not-a-tile | §6 |

---

## 1. Surfaces at a glance

The epic adds two webview surfaces and reshapes one:

1. **Dashboard root** — gains a 3-way switch on `SetupDetectionState`. `configured` is today's dashboard; `suggest-setup` and `empty` are new full-pane states.
2. **Setup wizard** — a first-run flow (scan → curate → preview → confirm) hosted in the **Manage Team panel** (wizard layout). Not a separate webview.
3. **Manage Team panel** — a reopenable panel; wizard layout on first run, edit layout once a config exists. Owns the `claudeteam.yaml` format (normalizes on save — Decision 5).

Navigation entry points to the Manage Team panel:
- Setup-suggestion affordance "Set up team" CTA (§2.2).
- A persistent **"Manage Team"** action in the dashboard view title bar (codicon `gear` + aria-label "Manage Team") — always available in `configured` state so the user can re-open and edit (`ui:open-manage-team`).
- The empty-state card offers NO setup CTA (there's nothing to roster — §2.3).

---

## 2. Detection trichotomy + the three dashboard states (AC1 — Decision 2)

Host computes `SetupDetectionState` (`"suggest-setup" | "empty" | "configured"`) and emits `setup:detection { state, scanned }`. The webview switches the entire dashboard root on this value. Precedence (host-side, restated from backlog for UX clarity): **config present → `configured`; else ≥2 scanned agents → `suggest-setup`; else → `empty`.**

### 2.1 `configured` — normal dashboard

The existing dashboard renders unchanged (session blocks, team cards, tiles, background chip). Per-member character rendering (§5.3) replaces the hardcoded gender binding. Adds the title-bar "Manage Team" action.

### 2.2 `suggest-setup` — ≥2 agents detected, no config yet

The full dashboard area renders a **dismissible in-panel card** (the `PROPOSAL` lean — see §7.2), NOT a transient toast.

```
┌─────────────────────────────────────────────────────────┐
│  ⚙  Orchestration detected                          [✕]  │   ✕ = dismiss (ui:dismiss-setup-suggestion)
│                                                           │
│  This project has 6 agents but no ClaudeTeam roster yet.  │   "6" = scanned.length, host-supplied
│  Set up a team to see them as named tiles.                │
│                                                           │
│            [  Set up team  ]   [ Not now ]                │   "Set up team" → ui:open-manage-team (wizard)
└─────────────────────────────────────────────────────────┘    "Not now" → same as ✕ dismiss
```

- **Icon:** codicon `gear`/`organization`, paired with the heading text (no icon-only).
- **Count line** uses `scanned.length` from the `setup:detection` payload — never a hardcoded number.
- **"Set up team"** opens the Manage Team panel in wizard layout (`ui:open-manage-team`; the host knows no config exists so it serves the wizard).
- **Dismiss** (✕ or "Not now") sends `ui:dismiss-setup-suggestion`; the card collapses and the dashboard shows whatever live agents exist as background noise (today's collapsed-noise behavior). Remember-per-workspace: see §7.2.
- **Card is a flex/grid popover-class element** → if toggled via the `hidden` attribute it MUST carry the `[hidden] { display:none }` guard (conventions doc — author `display` beats UA). Flag for Maya in §8.

### 2.3 `empty` — fewer than 2 agents

The full dashboard area renders a centered empty-state card. **EXACT copy (LOCKED — quote verbatim, no trailing period, no rewording):**

> This project has no orchestration setup, nothing to show

```
┌─────────────────────────────────────────────────────────┐
│                                                           │
│                        ( · · · )                          │   muted codicon (telescope/inbox), aria-label
│                                                           │   "no orchestration setup"
│      This project has no orchestration setup,             │
│                nothing to show                            │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

- **Copy is the literal string** above. Maya hardcodes it EXACTLY; Sage asserts an EXACT match (TS-04 AC2). No "Set up team" CTA here — with <2 agents there is nothing meaningful to roster, and offering setup would mislead.
- **Visual treatment:** centered vertically + horizontally in the pane; text in `--vscode-descriptionForeground` (muted); icon in the same muted token; generous vertical breathing room (`--ct-space-lg` above/below). No border, no card chrome — a quiet empty state, not an error.
- **Theme-aware:** all color via `--vscode-*` tokens; no hardcoded hex.

---

## 3. Setup wizard (AC2 — Decision 3)

First-run flow inside the Manage Team panel. Four steps, linear with back-nav. The panel header shows a 3-dot step indicator (Scan · Curate · Confirm).

### 3.1 Step 1 — Scan results (curate include/exclude)

Host has already scanned `.claude/agents/*.md` → `ScannedAgent[]` (in the `setup:detection` payload). The wizard renders one checkbox row per `ScannedAgent`, **all checked (included) by default**:

```
  Set up your team — choose which agents to include

  [✓]  felix          felix.md
  [✓]  maya           maya.md
  [✓]  nora           nora.md
  [✓]  sage           sage.md
  [✓]  bram           bram.md
  [ ]  iris           iris.md          ← user unchecked = excluded

  6 detected · 5 included

                                   [ Cancel ]   [ Preview → ]
```

- **Row content:** checkbox + `agentName` (bold, = `ScannedAgent.agentName`) + `filePath` basename (muted, for disambiguation). No icon-only.
- **Default state:** every agent checked. Curation is opt-OUT (uncheck to exclude) — most users want their whole team.
- **Live count line:** "N detected · M included" updates as boxes toggle.
- **"Preview →"** is disabled when 0 included (can't generate an empty roster). Enabled at ≥1.
- The **orchestrator is never in this list** — the scanner reads `agents/*.md` files only; the main session has no agent file (§6.2). No filtering logic needed in the wizard; it's a property of the data source.

### 3.2 Step 2 — Preview generated config

The wizard shows a read-only preview of the `ClaudeTeamConfig` the host will write, rendered as a friendly summary (NOT raw YAML — the panel owns the format, the user never hand-edits):

```
  Preview — this is your starting team

  Team: <workspace folder name>          ← team.name seed = folder basename
  ┌──────────────────────────────────────────────────┐
  │  [FE]  felix     role: —      character: not set   │  per included agent
  │  [MA]  maya      role: —      character: not set   │  display = agentName seed
  │  [NO]  nora      role: —      character: not set   │  role blank, character null
  │  [SA]  sage      role: —      character: not set   │
  │  [BR]  bram      role: —      character: not set   │
  └──────────────────────────────────────────────────┘

  You can rename, set roles, and pick characters after setup.

                              [ ← Back ]   [ Confirm & create ]
```

- **Fresh-member shape (Decision 3, LOCKED):** `display = agentName`, `role` blank (rendered as "—"), `character: null` → **text tile** (monogram chip `[FE]` etc. — the `whole-team-display-spec.md` fallback). `status: live`. `match: [{ agentType_equals: <agentName> }]` (immutable, seeded — not shown in the friendly preview but written by the host).
- **Monogram chip** = 2-letter initials of `display`, painted in the muted available background (member has no color + no character yet). Reuses the existing fallback-chip token (`--ct-radius-tile`).
- **"Confirm & create"** sends `ui:run-setup { include: string[] }` (the checked `agentName`s). Host generates + writes `claudeteam.yaml`, then emits `setup:config-saved { ok }` and a fresh `setup:detection { state: "configured" }`.

### 3.3 Step 3 — Confirm → first dashboard render

On `setup:config-saved { ok: true }`:
- Panel transitions from wizard layout to **edit layout** (§4) — the user lands in Manage Team with their new team, ready to set roles/characters. A success affordance: a brief inline confirmation banner "Team created" at the panel top.
- The dashboard root (behind/beside the panel) flips to `configured` and renders the new team's tiles — every member shows as a **text tile** (monogram chip, `available` state until a live agent matches). This is the "first dashboard render."

On `setup:config-saved { ok: false, error }`: stay on the preview step; surface the error inline ("Couldn't save: <error>") with a Retry. Do not lose the curated selection.

---

## 4. Manage Team panel — edit layout (AC3 — Decision 5)

Reopenable via the title-bar "Manage Team" action or the suggest-setup CTA (`ui:open-manage-team`). When a config exists, the host serves the **edit layout** (not the wizard).

### 4.1 Layout

```
┌──────────────────────────── Manage Team ─────────────────────────────┐
│  Team: ClaudeTeam Alpha                                                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ [FE] │ Display: [ Felix            ]  Role: [ Extension Host Dev ] ││  per member row
│  │ char │ Character: [ pick ▸ ]  felix-male  [ clear ]                ││  [FE]=current char thumb or monogram
│  └──────────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ [MA] │ Display: [ Maya             ]  Role: [                    ] ││  role empty = valid (lean OPTIONAL §7.3)
│  │ char │ Character: [ pick ▸ ]  (not set → text tile) [ clear ]     ││
│  └──────────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ [··] │ Display: [ Orphan           ]  Role: [ … ]   ⚠ orphaned     ││  greyed; see §6
│  │ char │                                          [ Delete member ]  ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                        │
│  Match keys are fixed (set from the agent filename) and not editable.  │
│                                                  [ Save team ]         │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Editable vs immutable fields

| Field | Editable? | Notes |
|---|---|---|
| `display` | **Yes** | free text; seeded from `agentName`. Empty display is invalid → block save + inline "Display name required". |
| `role` | **Yes** | free text; **MAY be empty** (lean OPTIONAL — §7.3). Empty renders as "—" on the tile. |
| `character` | **Yes** | via picker (§5); assign or clear. |
| `match` (`agentType_equals`) | **No** | immutable (Decision 4). Surfaced read-only with the help line "Match keys are fixed…". Never an input. |
| `status` | **No** (system) | `live` / `orphaned`; user acts on orphaned via Delete (§6). |
| `id` | **No** (system) | stable internal id, not shown. |

### 4.3 Save behavior + "panel owns the format" messaging

- **"Save team"** assembles the edited `ClaudeTeamConfig` and sends `ui:save-team { config }`. Host performs a **structured, normalized write** (NOT comment-preserving — Decision 5) and acks `setup:config-saved { ok, error? }`.
- On `ok: true`: inline transient banner "Saved" + the button returns to idle. The dashboard tiles update to reflect new display/role/character.
- On `ok: false`: inline error "Couldn't save: <error>" near the Save button; keep the user's edits in the form (do not discard).
- **Format-ownership messaging:** a one-line persistent hint at panel bottom: *"ClaudeTeam manages this file. Edits here are saved to .claude/claudeteam.yaml; manual edits to that file may be overwritten."* This sets the expectation that the panel — not hand-editing — is the editing surface, matching the host's normalize-on-save.

---

## 5. Character picker grid (AC3 — Decisions 5, 7)

Per-member character selection replaces the hardcoded gender→character binding (Decision 7; supersedes memory `project_persona_character_gender_binding`).

### 5.1 Opening the picker

Each member row's "Character: [ pick ▸ ]" opens an inline picker grid (a popover anchored to the row, OR a panel sub-view — Maya's layout call, both acceptable). It renders `CharacterSource[]` from the host's `setup:characters { sources }`.

### 5.2 Grid layout

```
  Pick a character for Maya                                    [✕]

  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
  │ 🧍 │ │ 🧍 │ │ 🧍 │ │ 🧍 │ │ 🧍 │ │ 🧍 │     thumbnails = CharacterSource.thumbnailPath
  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘
  felix-  maya-   nora-   bram-   custom  custom    label = CharacterSource.label
  male    female  female  male    -a      -b
  ·bundled·bundled·bundled·bundled· user · user ·   origin badge (bundled / user)

  [ Clear character (use text tile) ]
```

- **Each cell:** thumbnail (`CharacterSource.thumbnailPath`) + `label` below + a small **origin badge** ("bundled" / "user") so the user knows which are shipped vs their own. No icon-only — every thumbnail has a text label.
- **Merged list:** bundled + user sources in one grid, deduped by `id` (bundled wins on collision — host-side, documented in TS-02). Order proposal: bundled first, then user; alpha within each group.
- **Thumbnail source:** south rotation frame (`PROPOSAL` §7.1).
- **Selecting a cell** sends `ui:assign-character { memberId, character: <id> }`. The picker closes; the row's `[char]` chip updates to the chosen thumbnail.
- **"Clear character"** sends `ui:assign-character { memberId, character: null }` → member reverts to **text tile** (monogram chip). This is the explicit unassigned path.
- **Empty grid edge case:** if `sources` is empty (no bundled chars present — should never happen post-build, but defend), show "No characters available" + the Clear/text-tile option only. Sage covers bundled-present-after-clean-build (TS-04 AC7); the webview just renders what it's given.
- **Picker is a flex/grid popover** → `[hidden]` guard required if toggled via `hidden` (§8 flag for Maya).

### 5.3 Tile rendering: character vs text tile

- **`character` set** → the member's tile renders that character's sprite (the existing sprite render path, now driven by `Member.character` instead of the gender binding).
- **`character: null`** → **text tile**: monogram chip (`[FE]`) in the 68px leading box, per the `whole-team-display-spec.md` fallback. Identity-preserving without a sprite.
- This applies across all states (running/idle/finished/error/available) — the character/text-tile choice is orthogonal to state; state still drives the dot + activity line.

---

## 6. Orphan/stale tiles + orchestrator-not-a-tile (AC6 — Decisions 3, 6)

### 6.1 Orphan/stale treatment (Decision 3)

When an agent's `.md` file is removed but its member still exists in `claudeteam.yaml`, the host flips `Member.status` to `"orphaned"` (kept, not auto-deleted). Both the dashboard tile and the Manage Team row treat it as orphaned:

**Dashboard tile (orphaned):**
```
┌────┐  ⚠ Orphan (display)        agent file removed
│ ·· │  greyed, opacity ~0.5, NO live state dot (it can never go running)
└────┘  aria-label "orphaned — agent file removed"
```
- **Greyed:** whole tile at `opacity: 0.5` (the "dead" tier from the whole-team legibility ramp — quieter than `available` 0.6). Desaturated/muted character or monogram.
- **No live state dot** — orphaned can never be `running`/`idle`/`finished`; render a neutral muted marker + the text "agent file removed" (icon paired with text).
- It is NOT silently dropped — the sponsor must see that a rostered member lost its backing agent file, and decide.

**Manage Team row (orphaned):** greyed row with a `⚠ orphaned` badge + a **"Delete member"** button. Clicking it shows a **confirm-delete** affordance (inline confirm, not a destructive one-click):
```
  Delete "Orphan" from the team?  Its match key and settings are removed.
                                        [ Cancel ]   [ Delete ]
```
- **Confirm** sends `ui:confirm-orphan-delete { memberId }`. Host removes the member, re-writes, acks. The tile disappears on the next `setup:detection`/state update.
- **Cancel** keeps the orphaned member (greyed) — a valid choice if the agent file will return.
- The confirm panel is a `[hidden]`-toggled flex element → `[hidden]` guard required (§8). (The existing remove-confirm popover bug — PR #120→#122 — is the precedent; do not repeat.)

### 6.2 Orchestrator-not-a-tile (Decision 6)

The orchestrator (the main Claude Code session) MUST NEVER appear as a roster member or tile, anywhere:
- **Setup wizard** — the scanner reads `.claude/agents/*.md`; the orchestrator has no agent file, so it never enters `ScannedAgent[]`. The wizard list cannot offer it. No filter needed — it's absent by construction.
- **Manage Team panel** — operates on `ClaudeTeamConfig.teams[].members`, which only ever contains scanned-agent-derived members. The orchestrator can't be added (no agent file to seed a `match` key).
- **Dashboard** — the session block already renders the parent session as a *header* (not a tile); members are sub-agents only. This is unchanged. The spec note exists so neither the wizard, the panel, nor any future "add member" affordance ever surfaces the main session as a selectable/assignable member.
- **Explicit constraint for implementers:** if any future UI offers an "add member manually" path (out of scope here), it must exclude the orchestrator. For TS-02/TS-03 the data-source property guarantees it.

---

## 7. Ratify-on-return proposals

The following four are **NOT blockers** — they are spec defaults the sponsor ratifies on return. Each is labelled. Felix/Maya implement the lean; the sponsor's ratification may flip them with low cost (paths behind constants, affordance is a swap).

### 7.1 PROPOSAL — sponsor ratify: user-character-folder path + validation + thumbnail source

- **Path:** `~/.claudeteam/characters/` (Windows: `C:\Users\<user>\.claudeteam\characters\`). One subfolder per character.
- **Valid-character validation:** a subfolder is a valid character iff it contains BOTH `animations.json` AND a `_pixellab_anims/` directory (the PixelLab harvest shape). Folders missing either are skipped (logged, not surfaced as error — a half-finished harvest shouldn't break the picker).
- **Picker thumbnail source:** the **south rotation frame** (front-facing idle frame) of the character — the most recognizable single still. Host resolves it to `CharacterSource.thumbnailPath`.
- **Felix gating:** the path lives behind a flippable constant (per backlog) so ratification is a one-line change.
- **Recommendation:** ship the lean. `~/.claudeteam/characters/` mirrors the (now-dropped) `~/.claudeteam/` roster convention users may already know; the `animations.json` + `_pixellab_anims/` pair is the unambiguous PixelLab-harvest signature.

### 7.2 PROPOSAL — sponsor ratify: suggest-setup affordance form + dismiss/remember

- **Option A (lean — recommended):** dismissible **in-panel card** (§2.2) inside the dashboard area, with **remember-per-workspace** — once dismissed, the card stays dismissed for that workspace until a config is created or the agent count materially changes. Persist the dismiss flag in workspace state (`vscode.Memento` workspaceState — Felix's call on storage; webview just sends `ui:dismiss-setup-suggestion`).
- **Option B:** transient **toast** (VS Code notification). Rejected for the lean: toasts vanish and can't be re-found; a persistent-until-dismissed card keeps the setup path discoverable without nagging.
- **Recommendation:** Option A. A card is discoverable, dismissible, and re-surfaces sensibly; remember-per-workspace prevents nagging while keeping the title-bar "Manage Team" action as the always-available manual entry.

### 7.3 PROPOSAL — sponsor ratify: role/title optional vs required

- **Lean — OPTIONAL.** A member is valid with an empty `role`. Empty role renders as "—" on the tile and an empty (placeholder "optional") input in the panel. Only `display` is required.
- **Recommendation:** optional. Roles are nice-to-have labels; forcing one on every member adds setup friction for a field many users won't fill. Display name carries identity; role is decoration.

### 7.4 PROPOSAL — sponsor ratify: multi-root resolution

- **Lean — first workspace folder only.** Resolve `claudeteam.yaml` from `workspace.workspaceFolders[0]/.claude/claudeteam.yaml` (the host already computes this at `main.ts:482`). Full multi-root (per-folder rosters, a folder switcher in the panel) is **deferred** to a follow-up.
- **UX note for the deferral:** in a multi-root workspace, the panel header could show the resolved folder name so the user knows which root the team belongs to ("Team for <folder>"). Low-cost transparency; include if cheap, otherwise defer with the rest.
- **Recommendation:** first-folder-only for V1. Multi-root workspaces are rare for orchestrated projects; the cost of full support isn't justified yet.

---

## 8. Felix-zone vs Maya-zone decomposition (AC5)

Parallel-safe ownership zones so Wave-1 (TS-02 Felix) and Wave-2 (TS-03 Maya) don't collide. **Pattern A applies (LOCKED):** TS-02 lands the shared Vocabulary-contract types/schema/messages in `src/shared/*` FIRST; TS-03 dispatches only after they merge to main. The shared files (`src/shared/types.ts`, `src/shared/messages.ts`) are the ONLY overlap surface, and Felix owns authoring them.

### Felix-zone (host) — TS-02

| File | Responsibility | Vocabulary contract |
|---|---|---|
| `src/shared/types.ts` | Author shared types FIRST | `ClaudeTeamConfig`, `ScannedAgent`, `Member.character` (`MemberCharacter`), `CharacterSource`, `MemberStatus`, `SetupDetectionState` |
| `src/shared/messages.ts` | Author message types FIRST | host→wv `setup:detection` / `setup:characters` / `setup:config-saved`; wv→host `ui:open-manage-team` / `ui:run-setup` / `ui:save-team` / `ui:assign-character` / `ui:confirm-orphan-delete` / `ui:dismiss-setup-suggestion` |
| `src/extension/roster/schema.ts` | Extend zod schema for `version` / `character` / `status` | validates `ClaudeTeamConfig` |
| `src/extension/roster/*` (scanner, gen/write, char-source resolver — Felix names) | `.claude/agents/*.md` scan → `ScannedAgent[]`; starter-config gen; normalized write; `resolveCharacterSources()` | produces `ScannedAgent[]`, `ClaudeTeamConfig`, `CharacterSource[]` |
| `src/extension/main.ts`, `src/cli/agentTree.ts`, `openRoster.ts`, `package.json` | project-scope resolution; DROP global; detection compute; emit `setup:detection`; wire `ui:*` handlers | `SetupDetectionState`, `setup:*` |

### Maya-zone (webview) — TS-03 (after TS-02 merges)

| File | Responsibility | Consumes (read-only) |
|---|---|---|
| `src/webview/components/**` | Manage Team panel (wizard + edit layouts), 3 dashboard states, empty-state card, suggest-setup card, character-picker grid, orphan tile | `ClaudeTeamConfig`, `ScannedAgent[]`, `CharacterSource[]`, `SetupDetectionState` |
| `src/webview/main.ts`, `messageReceiver.ts` | send `ui:*`; receive `setup:*` | the message types above |
| `src/webview/styles/dashboard.css` | panel + grid + 3-state styling; **`[hidden]` guards** on every flex/grid popover | existing `--ct-*` + `--vscode-*` tokens |
| `src/webview/sprites/**` | per-member character render path; **replace gender binding** with `Member.character` | `Member.character` |

### Maya-flag checklist (popover `[hidden]` guards — conventions doc, PR #120→#122 precedent)

Every flex/grid element toggled via the `hidden` attribute MUST carry an explicit `.<class>[hidden] { display:none }` guard (author `display` beats UA default). New popovers introduced by this epic that need the guard:
- suggest-setup card (§2.2) — if toggled via `hidden`
- character-picker grid popover (§5.2)
- orphan confirm-delete panel (§6.1)
- any wizard step shown/hidden via `hidden`

The guard test must be **source-derived, non-vacuous** (per conventions doc — not a hardcoded allowlist).

### No new design tokens

This spec introduces **zero new color/space tokens**. It reuses:
- `--ct-color-state-*` (running/idle/finished/error) and the muted `available`/`idle-quiet` treatment from `whole-team-display-spec.md`.
- `--ct-radius-tile` + the monogram-chip fallback for text tiles.
- `--vscode-descriptionForeground` for muted empty-state/orphan text; `--vscode-foreground` for primary text.
- Orphan greying uses `opacity` on existing tiles (no new token).

Theme-aware first: all colors via `--vscode-*` or existing `--ct-*` tokens; no hardcoded hex beyond the semantic state dots that already exist.

---

## 9. Open questions for implementers (non-blocking)

- **Wizard host surface:** the Manage Team panel is the wizard host (a layout mode), not a separate webview. Maya's call whether wizard/edit are two component trees or one with a mode flag — both fine.
- **Picker anchoring:** inline row-popover vs panel sub-view for the character grid — Maya's layout call (§5.1); both acceptable.
- **Multi-root folder label** in the panel header — include if cheap, else defer with §7.4.

These are layout-freedom items, not spec gaps — the behavior and data contracts above are fixed.
