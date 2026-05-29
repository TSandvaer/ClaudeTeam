# Whole-team-always-visible dashboard — design spec

Design spec for **EPIC 86ca11187** (sponsor decision 2026-05-28, `team/DECISIONS.md` § "Whole-team-always-visible dashboard"). The dashboard's display model changes from **"render a tile per detected live agent matched to the roster"** to **"seed a tile for the FULL roster as an always-present baseline, with live state overlaid when detected."** Plus persona pixel-character rendering in the tile, a corrected session-title hierarchy, and two explicit user-driven culling actions (hide / remove — never auto-hide).

- **Epic:** [ClickUp 86ca11187](https://app.clickup.com/t/86ca11187) — whole-team-always-visible dashboard (full-roster baseline tiles + persona pixel-char rendering + hide/remove agent UX).
- **Owner:** Iris (this spec). **Peer reviewer:** Maya (visuals — tile layout, sprite placement, hide/remove affordances) ↔ Felix (spec edges — reducer baseline-seeding, never-run state, persisted hidden/removed filters, where `customTitle` already lives on the wire).
- **Downstream impl tickets:** filed by orchestrator AFTER sponsor approves this spec direction (epic breaks into Felix host-side + Maya webview-side + Sage test sub-tickets per DECISIONS § Implication).
- **Authoring discipline:** Theme-aware first (CLAUDE.md hard rule). Honors the M4-01 `--ct-*` token vocabulary — extends it, does not re-specify. No new icon set without text/aria pairing. No data-model field assumed without a Felix sign-off note (§9).

## Source artifacts (all read on `main` HEAD by Iris 2026-05-29)

- `team/DECISIONS.md` §26-42 (2026-05-28 epic decision) — the authoritative epic statement; auto-hide REJECTED; hide=reversible, remove=yaml-gated.
- `team/iris-ux/m4-polish-spec.md` §1 — the `--ct-*` token block (colors / spacing / radius / state dots / duration). This spec consumes those tokens verbatim and adds the minimum new ones in §8.
- `team/iris-ux/m4-polish-spec.md` §2.2 — per-state visual conventions (running = pulse + full opacity; idle = static + `opacity:0.78` on rows 2-4; finished = check overlay; error = one-shot flash).
- `team/iris-ux/m2-dashboard-tile-spec.md` §4 — current session-header DOM (`.session-id` first, `.session-title` last) + dead-session treatment (`.session-block--dead`, `.session-dead-badge`, `opacity:0.5`).
- `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` §2-3 — member-color-on-running-dot + hide-idle filter precedent (the structural pattern this spec's hide-agent re-uses).
- `team/iris-ux/86c9zmqa8-uniform-cluster-spec.md` §3-4 — option-matrix format + header-only/collapse precedents.
- `.claude/docs/persona-pixel-character-animation-prompts.md` — sprite architecture (state-per-pose group; south 68px; `idle*` pool; `working`/`reading` triggers; SLOW playback + hold-final-frame dwell as the render default; harvest layout `assets/sprites/<CharName>/`).
- `.claude/docs/architecture-overview.md` + `.claude/docs/vscode-extension-conventions.md` § "Session label resolution" — `resolveSessionLabel(rec)` already exists; `customTitle` already on the wire as part of the label chain.
- `.claude/docs/roster-matching.md` — roster YAML schema, per-project default, `member.color` validation.

---

## 0. Scope summary

| § | Surface | Lane |
|---|---|---|
| §1 | Problem + display-model shift (design) | — |
| §2 | Full-roster baseline tiles — the five states incl. never-run | host (reducer baseline seed) + webview |
| §3 | Persona pixel-character rendering in the tile | webview (sprite player) + Felix wire (sprite availability flag) |
| §4 | finished-vs-idle in always-visible layout — **RECOMMENDATION** | webview state mapping |
| §5 | Session-title prominence (corrected hierarchy) | webview header (uses existing resolver) |
| §6 | DEAD-card presentation + "hide dead" recommendation | webview header |
| §7 | hide-agent (reversible) + remove-agent (yaml-gated) UX | host (persisted filter) + webview (affordances) |
| §8 | Design tokens (new + reused) | webview CSS |
| §9 | Data-model asks for Felix (sign-off gated) | host |
| §10 | Sponsor open questions | away-queue feed |
| §11 | Out of scope / guardrails | — |

---

## 1. Problem statement + the display-model shift

### 1.1 Today's model (detected-only)

The reducer (`src/extension/state/reducer.ts`, per DECISIONS § Context) builds an `AgentTile` ONLY when a live agent is **detected** and **matched** to a roster member. A roster member who never ran this session produces **no tile at all**. Consequence the sponsor hit: after flipping `hideIdleAgents` (#108) and their `hideFinishedAgents` user setting, Iris / Nora / Bram still did not appear — because they had no dispatch this session, so the reducer never minted their tiles. "Show idle" / "show finished" only ever reveal members who *happened to run*.

### 1.2 The new model (roster-baseline + live overlay)

```
roster member (teams.yaml)  ── ALWAYS ──▶  a tile exists
        │                                       │
        └── live agent detected? ── YES ──▶ overlay state (running/idle/finished/error) + activity + sprite pose
                                  └─ NO  ──▶ baseline "available" state (never-run); idle-pool sprite loops
```

The roster is the source of truth for **which tiles exist**; live detection is the source of truth for **what state a tile is in**. This is the inversion: tiles are seeded from `teams.yaml`, not from detections.

### 1.3 What stays the same

- **Background noise unchanged.** Unrostered agents still collapse to the per-session count chip (`roster-matching.md` § Background-noise). This spec is a rostered-tile concern only.
- **Session-scoping unchanged.** cwd-against-workspace filter (`vscode-extension-conventions.md` § Session filter) still decides which *sessions* render. Baseline roster tiles live INSIDE each surfaced session's team card (see §1.4).
- **Per-state semantic colors unchanged.** `--ct-color-state-*` from M4-01 §1.2.3 are reused as-is. Running keeps the optional per-member color (86c9zmyef §2).

### 1.4 Where baseline tiles live (host/Felix edge — flag for review)

A roster member belongs to a team; a team renders under each surfaced **session block**. The natural placement: **baseline tiles render inside the team card of each live session block** that the roster applies to. Open structural question for Felix in §9 — when zero sessions are live (empty dashboard), the roster baseline still wants to show "your team, all available." Recommended: a **roster-baseline team card renders even with no live session** (a session-less "Team roster" block), so the dashboard is never empty when a roster exists. See §10 Q1.

---

## 2. Full-roster baseline tiles — the five states

Every `teams.yaml` member ALWAYS has a tile. The tile's *content* (sprite pose, activity line, dot) varies across five states. The first three (running/idle/finished/error) already exist per M4 §2.2; **never-run/available is net-new** and is the heart of this section.

### 2.1 Tile anatomy (extends M2 §5 + adds the sprite area)

```
┌──────────────────────────────────────────────┐
│  ┌────────┐                                    │   ← .agent-tile[data-state]
│  │        │  ● Felix                  [hide ⋯] │   row 1: state-dot + display name + overflow affordance
│  │ SPRITE │  Extension Host Dev                │   row 2: role            (.tile-row--role)
│  │ 68×68  │  tool:Edit src/extension/…         │   row 3: activity        (.tile-row--activity)
│  │        │  Sonnet · running 2m               │   row 4: model · state·elapsed (.tile-row--model)
│  └────────┘                                    │
└──────────────────────────────────────────────┘
```

- The **sprite area** is a fixed 68×68 box at the tile's leading edge (LTR: left). Text rows sit to its right. Full sprite spec in §3.
- Rows 2-4 are the existing M2 rows. The `[hide ⋯]` overflow affordance is net-new (§7).
- `data-state` drives all per-state CSS (existing M4 mechanism). New value: `data-state="available"` for never-run.

### 2.2 Per-state treatment table

| State | `data-state` | State dot | Sprite pose | Text rows | Activity row (row 3) |
|---|---|---|---|---|---|
| **never-run / available** | `available` | `--ct-color-state-idle-quiet` (new muted grey-blue, §8) — a low-key dot, NOT orange. Paired aria-label "available". | idle-pool loop (calm), SLOW playback (§3) | row 1 full opacity; rows 2-4 `opacity:0.6` (quieter than idle's 0.78 — this member isn't even alive) | `available` (literal muted text; no tool line) |
| **idle** (alive, JSONL stale >10s) | `idle` | `--ct-color-state-idle` (`#ffa726`), static | idle-pool loop | rows 2-4 `opacity:0.78` (M4 §2.2) | last `tool:` line, dimmed; or `idle` |
| **running** (working / reading) | `running` | per-member color if set, else `--ct-color-state-running` (`#4caf50`); **pulse** 1.8s (M4 §2.4) | `working` (tool≠Read) or `reading` (tool==Read) pose; SLOW playback | full opacity | `tool:<name> <arg>` + `running Xs` |
| **finished** | `finished` | `--ct-color-state-finished` (`#78909c`) + check overlay (M4 §2.5) | idle-pool loop (see §4 — finished folds to idle-pose visually) | full opacity | `finished Xs` |
| **error** | `error` | `--ct-color-state-error` (`#ef5350`); one-shot flash on entry (M4 §2.4) | idle-pool loop (no error sprite in V1) | full opacity | error summary (one line) |

### 2.3 never-run "available" — design rationale

The never-run tile must read as **"this is a real team member, just not active"** — present and identifiable, not greyed-to-death (that's DEAD's job, §6) and not alarming (orange idle implies "was working, went quiet"). Treatment:

- **Distinct quiet dot** (`--ct-color-state-idle-quiet`, §8) so the sponsor can tell never-run from went-idle at a glance. Aria-label "available" (text-paired per design discipline).
- **Sprite still animates** (idle-pool loop) so the tile has life — this is the whole-team-thesis payoff: even a quiet member has visual presence (memory `[[dashboard-whole-team-always-visible-thesis]]`).
- **Rows 2-4 at `opacity:0.6`** — quieter than live-idle's 0.78, louder than dead's 0.5. A three-step legibility ramp: dead (0.5) < available (0.6) < idle (0.78) < running/finished (1.0).
- **No tool line.** Row 3 reads the literal muted word `available`. Nothing to report.

### 2.4 ASCII — full roster, mixed states (one live session)

```
╔══ SESSION  "claude team - continued"            [claude-vscode]  main ══╗   ← §5 corrected hierarchy
║  ┌─ ClaudeTeam Alpha ─────────────────────────────────────────────────┐ ║
║  │  ┌────┐ ● Felix          tool:Edit reducer.ts      Sonnet·running 2m │ ║  running (green/member pulse)
║  │  │spr.│ Extension Host Dev                                  [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  ┌────┐ ● Maya           tool:Read agentTile.ts     Sonnet·running   │ ║  running (reading pose)
║  │  │spr.│ Webview UI Dev                                      [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  ┌────┐ ◐ Sage           finished 4m                Sonnet·finished  │ ║  finished (check overlay)
║  │  │spr.│ QA                                                  [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  ┌────┐ ○ Nora           available                                   │ ║  never-run (quiet dot, dim rows)
║  │  │spr.│ Planning Lead                                       [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  ┌────┐ ○ Iris           available                                   │ ║  never-run
║  │  │spr.│ UX Designer                                         [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  ┌────┐ ○ Bram           available                                   │ ║  never-run
║  │  │spr.│ Research                                            [⋯]      │ ║
║  │  └────┘                                                              │ ║
║  │  + 3 background agents (this session)                          [▸]   │ ║  unchanged noise chip
║  └──────────────────────────────────────────────────────────────────────┘ ║
╚════════════════════════════════════════════════════════════════════════════╝
   dot legend:  ● running   ◐ finished(check)   ○ available/quiet   (idle = filled amber, error = red)
```

The win is visible: Nora / Iris / Bram now render even though they never dispatched this session.

---

## 3. Persona pixel-character rendering in the tile

The M01/F01-style **68px south-facing** pixel characters animate inside each tile's sprite box. Architecture is **state-per-pose** (`.claude/docs/persona-pixel-character-animation-prompts.md` § Architecture): a character is a GROUP — base char + one PixelLab *state* per pose, each carrying one residual-motion animation. The webview is a frame-sequence player; no PixelLab calls at runtime.

### 3.1 Tile sprite area

- **Box:** 68×68 px, fixed, at the tile's leading (inline-start) edge. Token `--ct-sprite-size: 68px` (§8).
- **Placement:** vertically centered against the text rows; `--ct-space-s` (8px) gap to the name column.
- **Rendering:** `image-rendering: pixelated` (no smoothing — these are pixel sprites). Sprite sits on transparent tile background; no frame/border on the sprite itself.
- **No layout shift between poses.** Every pose in a character's group is the same canvas size (south, 68px), so swapping pose on activity-change never reflows the tile.

### 3.2 Pose → state mapping (drives which animation plays)

| Tile state / activity | Sprite pose (`animation_name`) |
|---|---|
| running, tool == `Read` | `reading` |
| running, tool != `Read` | `working` |
| idle / available / finished | a member of the `idle*` pool (random select; see §3.3) |
| error | idle-pool member (no dedicated error sprite in V1) |

Reverse-map authority: the harvested group ZIP's root `metadata.json` (`animation_name → folder`), per the persona doc § Webview wiring note. `reading` lives on a *different* state-UUID folder than `working`/idle — the webview must pull each from its sibling folder.

### 3.3 idle-pool selection + playback feel

- **Pool:** all anims whose name starts with `idle` (`idle`, `idle_snack`, `idle_stretch`, `idle_phone`, `idle_hips`, `idle_think`, `idle_arms_crossed`, `idle_pockets`, `idle_neck_roll`, `idle_yawn`, … per the M01/F01 build). The webview **picks one per tile per "idle episode"** and loops it; on a fresh idle episode (e.g. after a running stint), it may pick a different pool member so the tile isn't repetitive. Do NOT cycle pool members mid-loop (jarring).
- **Playback = SLOW + hold-final-frame dwell (the DEFAULT).** Per the persona doc § Playback-speed note: the dashboard is the consumer that decides speed; default to noticeably-slower-than-real-time, calm. Render contract Maya implements:
  - **(a) per-anim default frame duration** — default ~150-170ms/frame (slow/calm). Tunable per anim.
  - **(b) optional per-frame dwell override** — default: hold the FINAL frame(s) a beat (e.g. +300-500ms) before the loop restarts, so short idle loops don't read mechanically. Specific dwell points the persona doc calls out: `idle_stretch` dwells on the arms-overhead peak; `idle_phone` dwells at end-of-loop; sip/nibble dwell at the lips/peak.
- **Continuous-while-in-state.** A long Read loops `reading` many times — the loop is seam-free (persona doc § Residual-motion). The webview never resets to frame 0 on a state-internal tick; only on a pose CHANGE.

### 3.4 Sprite fallback (member has no sprite yet)

Only M01/F01 sprites exist today; the other roster members have none. The tile MUST degrade gracefully:

- **Fallback = the M4-01 colored state dot + a monogram chip** in the 68px box. The chip is a `--ct-radius-tile` rounded square showing the member's **2-letter initials** (e.g. "FE", "MA"), painted with the member's `color` (running) or the muted available/idle background. This preserves the leading-edge visual anchor + per-member identifiability without a sprite.
- The state dot in row 1 still renders (it's independent of the sprite). So a sprite-less member is fully functional — just shows a monogram instead of a character.
- **No layout difference** sprite vs. fallback — both occupy the same 68px box, so a roster with mixed sprite-coverage doesn't look ragged.
- Wire signal: the webview needs to know *whether a sprite exists for this member*. See §9 Felix ask (a sprite-availability flag, OR a webview-side asset-manifest lookup keyed by member id — recommend the latter so it's a pure webview concern, no host wire change).

---

## 4. finished-vs-idle in the always-visible layout — RECOMMENDATION

**The open nuance (sponsor-flagged):** in an always-visible layout, does a finished roster member *linger* as "finished" indefinitely, or fold back to "idle / available"?

### 4.1 Recommendation: **finished lingers as `finished` for the session, then folds to `available` on session death — never auto-folds to idle while the session is alive.**

Concretely:
- **While the session is alive:** a member that finished a dispatch **stays `finished`** (blue-grey dot + check overlay + `finished Xm` elapsed). It does NOT silently revert to idle/available. Rationale below.
- **Sprite during finished = idle-pool pose** (calm), NOT a special "finished" sprite — there is no finished sprite in V1, and a calm idle pose reads correctly for "done, resting." The **dot + check overlay** carries the "finished" semantics; the sprite carries "alive presence." This is why §2.2 finished-row says idle-pool sprite.
- **On session death:** finished/idle/running all collapse into the DEAD-card treatment (§6) — the session block goes dead; per-member state is moot.
- **Never-run members** stay `available` throughout (they never entered finished).

### 4.2 Rationale

1. **Finished is information the sponsor wants to keep.** "Sage finished 4m ago" is a real, useful audit fact in a live session. Folding it to "idle/available" erases the just-happened completion — the dashboard would lie about recency. The whole-team thesis is *accuracy*; auto-erasing finished is the opposite.
2. **The elapsed timer (`finished Xm`) is the natural decay.** Finished doesn't need to *change state* to fade in importance — the growing elapsed value already signals "this happened a while ago." The sponsor can read freshness without a state flip.
3. **It composes with hide (§7), not auto-hide.** If a long-finished tile becomes clutter, the sponsor **hides it manually** (reversible). That's the sponsor-mandated culling model — auto-folding-to-idle is a soft auto-hide, which the sponsor REJECTED for the harder cases; keep the model consistent.
4. **Distinct-from-available matters.** Folding finished → available would make "Sage finished its work" visually identical to "Sage never ran." Those are very different facts. Keep them visually distinct (check overlay vs. quiet dot).

### 4.3 The one concession — re-running clears finished

If a member that was `finished` is **detected running again** (new dispatch same session), the tile transitions `finished → running` immediately (M4 §2.6 transition handles the flash-free swap). Finished is "done *for now*," not sticky against new evidence.

> **This is a subjective-feel call** (per CLAUDE.md never-auto-decide list) — surfaced to the sponsor in §10 Q2 with this recommendation as the default.

---

## 5. Session-title prominence (corrected hierarchy)

### 5.1 The diagnosed problem (Bram live diagnosis)

Current header DOM (`m2-dashboard-tile-spec.md` §4): `.session-id` ("SESSION {shortId}") renders **first**, `.session-title` renders **last**. The UUID prefix reads as the dominant label even though the resolver (`resolveSessionLabel`, `vscode-extension-conventions.md` § Session label resolution) already computes the human title `customTitle > aiTitle > workspace-folder`. The sponsor's actual session label ("claude team - continued") is in the data but visually buried.

### 5.2 Corrected hierarchy

**Resolved title is the prominent header label. UUID is demoted to a small muted secondary chip (or tooltip).**

```
Current:   [SESSION 7b53d0ee] [claude-vscode] pid=68644  c:\…\ClaudeTeam   claude team - continued
            └── dominant ──┘                                                 └─ buried ─┘

Corrected: claude team - continued            [claude-vscode]  main          ⓘ 7b53d0ee
            └────── dominant ──────┘            entrypoint    git-branch      └ demoted ┘
```

New header order + treatment:

| Element | Class | Treatment |
|---|---|---|
| **Resolved title** | `.session-title` | **Primary label.** `--ct-color-fg`, `font-weight:600`, largest text in the header. Renders the `resolveSessionLabel` output. `data-label-source` attr stays (diagnostic). |
| Entrypoint chip | `.session-entrypoint` | Small muted chip, unchanged. |
| git-branch chip | `.session-git-branch` | Small mono chip when present (existing, `vscode-extension-conventions.md`). |
| **UUID prefix** | `.session-id` | **Demoted.** Small muted monospace chip at the trailing edge, prefixed with an info glyph + aria-label "session id". `--ct-color-fg-muted`, `--ct-radius-chip`. **Recommend: keep visible as a chip** (not tooltip-only) — it's load-bearing for cross-referencing JSONLs/logs, but it must not dominate. |
| pid | `.session-pid` | Fold into the UUID chip's `title` tooltip (or keep as a tiny muted chip next to it). Demote — pid is debugging detail. |
| cwd | `.session-cwd` | Keep as `title` tooltip on the resolved title (the workspace path is context, not a headline). |

### 5.3 Why chip-not-tooltip for the UUID

The UUID is needed for grepping JSONLs and matching log lines — hiding it entirely in a tooltip costs the sponsor a hover every time. A small muted trailing chip keeps it one glance away without competing with the title. (Sponsor can confirm in §10 Q3 if they'd rather tooltip-only.)

### 5.4 No new data needed

`resolveSessionLabel` and `customTitle`/`aiTitle`/`cwd`/`gitBranch` are all already on the wire (`vscode-extension-conventions.md`). This is a **pure webview header-DOM reorder + restyle** — no host change, no new field. Felix-edge: none. Maya owns it.

---

## 6. DEAD-card presentation + "hide dead" recommendation

### 6.1 Current behavior (Bram)

A dead session renders **header-only + a `[dead]` badge** (`.session-block--dead`, `opacity:0.5`, `--vscode-disabledForeground`; M2 §4 / M4-01 §1.2.2) and **persists until Claude Code deletes `~/.claude/sessions/{pid}.json`** (file-driven prune, `vscode-extension-conventions.md` § DEAD prune semantics). No timer prune. Neither Hide-finished nor Hide-idle touches it. Identity is `(sessionId, pid)` so a window-reload can briefly show two dead tiles for one session — expected audit shape.

### 6.2 How dead cards should look (read as audit-trail, not clutter)

The current `opacity:0.5` + `[dead]` badge is **directionally right** — keep it, with two refinements so it reads clearly as a tombstone rather than a broken live card:

```
┌─ ⊘ "claude team - continued"   [dead]   ⓘ 7b53d0ee ─┐   ← collapsed, single-line, dimmed
└──────────────────────────────────────────────────────┘
```

- **Collapse to a single header-only line.** No team card, no baseline roster tiles, no sprite area inside a dead block (sprites animating in a dead card would be misleading — implies life). Already mostly the case (no team cards render for dead sessions); this spec makes it explicit: **a dead block never seeds baseline roster tiles.**
- **`[dead]` badge** stays, styled `--ct-color-state-error`-adjacent? **No** — recommend a **neutral muted badge** (`--ct-color-fg-muted` border, `--ct-radius-chip`), NOT error-red. Dead is not an error; it's "this process exited." Red would cry wolf. Keep it grey/muted with the existing `opacity:0.5` block treatment.
- **Resolved title still shows** (per §5) so the sponsor knows *which* session died — apply the §5 hierarchy to dead headers too (title prominent, UUID demoted), just at 0.5 opacity.
- A **`⊘` leading glyph** (paired aria-label "dead session") reinforces the tombstone read at a glance.

### 6.3 "Hide dead sessions" control — RECOMMENDATION: **YES, add it — opt-IN, default OFF, and a count-collapsed group.**

- **Default OFF** (dead cards visible) — the audit-trail value (which sessions ran, in what order) is the point; don't hide by default.
- **Add a settings scalar `claudeteam.hideDeadSessions` (default `false`)** + a header **dead-count chip** that mirrors the background-noise pattern: when there are dead sessions, show `⊘ 2 dead sessions [▸]` collapsed by default-OFF means expanded, but offer a **one-click collapse** on the group so a window-reload that spawns 3 dead duplicates can be folded into `⊘ 3 dead [▸]` without losing them.
  - This composes with §7's hide model: dead-collapse is a *group* fold (like background noise), distinct from per-agent hide. Reversible (expand the chip).
- **Rationale:** the documented failure mode (window reload → multiple dead tiles for one session) is exactly when dead cards become clutter. A collapsible count chip keeps the audit trail (count + expand) without the wall of tombstones. Don't auto-prune on a timer (file-driven prune already removes them when Claude Code cleans up); just let the sponsor collapse the group.

> **Subjective-feel + new-scalar call** — surfaced in §10 Q4 with "yes, opt-in count-collapsed group" as the recommended default.

---

## 7. hide-agent (reversible) + remove-agent (yaml-gated) UX

Sponsor REJECTED auto-hide (DECISIONS §36). Both culling actions are **explicit, user-initiated**. Hide is reversible in-UI; remove edits the roster YAML.

### 7.1 The overflow affordance (`[⋯]`)

Each tile carries a trailing **overflow button** `[⋯]` (kebab/more), revealed on **tile hover OR keyboard focus** (not always-on — keeps the resting tile clean; design-discipline low-noise). aria-label "agent actions". Activating it opens a small menu:

```
┌──────────────────────┐
│  Hide Felix           │   ← reversible; per-tile
│  Remove from roster…  │   ← yaml-gated; trailing … = confirm step
│  Open transcript      │   ← existing drill-in, relocated here (optional)
└──────────────────────┘
```

- The menu is keyboard-navigable (Up/Down/Enter/Esc), focus returns to `[⋯]` on close (focus management — design discipline).
- On touch/no-hover, the `[⋯]` is always visible (graceful — but VS Code webview is mouse+keyboard, so hover-reveal is the primary).

### 7.2 Hide agent (reversible)

- **Action:** "Hide Felix" → the tile drops from the **default view** immediately (fade-out over `--ct-duration-state-transition`, no reflow flash).
- **Persists across reloads** — host-side persisted set of hidden member ids (DECISIONS §29). See §9 Felix ask.
- **Recovery surface:** a header **"N hidden [show]"** chip (mirrors the background-noise / dead-count chip pattern). Clicking `[show]` reveals hidden members rendered at `opacity:0.55` with an "unhide" affordance:

```
   ⋯ 2 hidden agents  [show]        ← collapsed default
   ── expanded ──
   ┌────┐ ○ Bram (hidden)   [unhide ↩]
   └────┘ Research
```

- **Per-agent un-hide:** the `[unhide ↩]` on a revealed hidden tile (or a "Show Bram" entry in its `[⋯]` menu) returns it to the default view. Reversible, no YAML edit.
- **Scope:** hide is **per roster member id**, applies wherever that member would render (all sessions). It's a view preference, not a per-session state.

### 7.3 Remove agent (yaml-gated)

More permanent than hide. The member is **fully suppressed — not even under "show hidden"** — and returns ONLY by re-adding to `teams.yaml` (DECISIONS §30).

- **Action:** "Remove from roster…" (trailing `…` signals a confirm step).
- **Confirmation dialog** (required — destructive-ish, edits config):

```
┌─ Remove Felix from the roster? ───────────────────────┐
│  This edits teams.yaml. Felix will no longer appear     │
│  on the dashboard at all — not even under "show hidden".│
│  To bring Felix back, re-add the member in teams.yaml.  │
│                                                         │
│             [ Cancel ]   [ Open teams.yaml ]  [ Remove ]│
└─────────────────────────────────────────────────────────┘
```

- **What "Remove" does:** because the matcher does NOT auto-discover and the roster is the source of truth, removal must **edit `teams.yaml`** (delete or comment-out the member block). Two implementation shapes for Felix (§9 ask):
  - **(A) Direct YAML edit** by the extension host (rewrite the file, dropping the member). Cleanest UX (one click) but the extension now WRITES to a sponsor-owned config file — needs Felix sign-off on safety (preserve comments/formatting; YAML round-trip is lossy).
  - **(B) Guided manual edit** — "Remove" opens `teams.yaml` at the member's block (reuse `claudeteam.openRoster`) and the dashboard shows a one-time hint "delete this member block and save." No auto-write; the YAML stays hand-edited (consistent with the existing "roster is hand-edited YAML, not a settings form" convention, `vscode-extension-conventions.md` § manifest essentials).
  - **RECOMMENDATION: (B) guided manual edit.** It keeps the extension read-only against the sponsor's config (matches the whole V1 read-only thesis — `architecture-overview.md` § Non-goals: "no agent control surfaces; read-only V1"), avoids lossy YAML rewrites, and the "Open teams.yaml" button is already in the dialog. The "[Remove]" button then becomes "[Open & remove]" → opens the file scrolled to the member. Surfaced in §10 Q5.
- **Restore is yaml-only by design** — no in-UI un-remove. Re-adding the member block to `teams.yaml` (which the watcher already reloads, `roster-matching.md` § Config locations) brings the tile back on the next match table rebuild.

### 7.4 hide vs. remove — the mental model (sponsor-facing copy)

- **Hide** = "tidy my view; I might want it back with one click." Reversible in-UI. Persisted.
- **Remove** = "this member isn't on the team anymore." Edits the roster source of truth. Comes back only via YAML.

This two-tier model maps cleanly onto the existing "view preference vs. source-of-truth" split everywhere else in the product.

---

## 8. Design tokens

### 8.1 Reused verbatim from M4-01 §1 (no redefinition)

`--ct-color-fg`, `--ct-color-fg-muted`, `--ct-color-bg-*`, `--ct-color-border`, `--ct-color-focus`, `--ct-color-state-{running,idle,finished,error}`, `--ct-space-{xs,s,m,l}`, `--ct-state-dot-size` (10px), `--ct-state-dot-gap`, `--ct-radius-{tile,chip}`, `--ct-duration-state-transition` (200ms). This spec consumes them; it does NOT re-specify them (honor-existing-tokens discipline).

### 8.2 New tokens introduced by this spec (minimal)

| Token | Value | Use |
|---|---|---|
| `--ct-sprite-size` | `68px` | Persona pixel-character box (and the monogram-fallback box — same size). |
| `--ct-color-state-idle-quiet` | `#90a4ae` (Material Blue-Grey 300 — distinct from finished's BG-400 `#78909c` and idle's amber) | never-run/available state dot. Semantic-color hex (survives theme switch) per CLAUDE.md state-indicator exemption. |
| `--ct-opacity-available` | `0.6` | never-run rows 2-4 (the middle rung of the 0.5/0.6/0.78/1.0 legibility ramp). |
| `--ct-opacity-hidden-reveal` | `0.55` | revealed-hidden tile under "show hidden". |
| `--ct-anim-frame-ms-default` | `160ms` | default persona sprite per-frame duration (SLOW default per persona doc). Tunable per anim. |
| `--ct-anim-dwell-ms-default` | `400ms` | default hold-final-frame dwell before loop restart. |

- Frame/dwell timing tokens are **render-contract values**, not CSS visual tokens — they parameterize the sprite player (§3.3). Document them in the same `:root` block for single-source-of-truth.
- `--ct-color-state-idle-quiet` is hardcoded hex (semantic state color) per the CLAUDE.md exemption — like the other four state colors. Theme-contrast: BG-300 passes on both light and dark editor backgrounds (mid-saturation, per `roster-matching.md` theme-contrast note).

---

## 9. Data-model asks for Felix (sign-off gated — no assumption)

Per CLAUDE.md "No data-model changes without Felix's sign-off," these are PROPOSALS for Felix to scope, not assumptions baked into the spec:

1. **Roster-baseline seeding (host/reducer).** The reducer must mint an `AgentTile` per `teams.yaml` member regardless of detection, defaulting to a new `AgentState = "available"` (never-run). Live detection overlays running/idle/finished/error. **Felix edge:** adding `"available"` to the `AgentState` union (`src/shared/types.ts:259`, currently `"running"|"idle"|"finished"|"error"`) is a shared-type change — confirm it doesn't break the CLI presenter / diagnostic panel / existing tests. *(Vocabulary contract if this dispatches in parallel: the new state literal is exactly `"available"`.)*
2. **Where baseline tiles live with zero live sessions** (§1.4 / §10 Q1) — does the host emit a session-less "roster baseline" block, or does the webview synthesize it? Recommend host emits it so the webview stays a pure renderer (`architecture-overview.md` § "state that exists in the host should NOT be duplicated in the webview").
3. **Persisted hidden-member set** (§7.2) — host-side persisted `Set<memberId>` (e.g. `workspaceState`/`globalState`), surfaced to the webview as a wire field (e.g. `tile.hidden: boolean` + a top-level `hiddenMemberIds: string[]`). Felix scopes storage scope (global vs. workspace — recommend global so a hidden member stays hidden across windows).
4. **Sprite availability** (§3.4) — RECOMMEND **no host wire change**: ship a webview-bundled `assets/sprites/` manifest keyed by member id; the webview looks up "does Felix have a sprite?" locally and falls back to monogram if absent. Keeps it a pure webview concern. Confirm sprites are bundled into the `.vsix` (`.vscodeignore` must NOT exclude `assets/sprites/`).
5. **Remove → YAML** (§7.3) — RECOMMEND option (B) guided manual edit (no host write to `teams.yaml`). If sponsor wants option (A) direct-write, Felix scopes the YAML-round-trip-safety cost (comment/format preservation).

---

## 10. Sponsor open questions (away-queue feed)

| # | Question | Iris recommendation |
|---|---|---|
| **Q1** | With **zero live sessions**, should the dashboard show a session-less "Team roster" baseline card (full roster, all available), or stay empty until a session starts? | **Show the baseline card.** A configured roster should never render an empty dashboard — the whole-team thesis wants the team always present. (Host emits it; §1.4 / §9.2.) |
| **Q2** | Should a **finished** member linger as `finished` for the live session (recommended), or fold back to `idle/available`? | **Linger as `finished`; fold only on session death; re-running clears it.** Preserves the just-happened completion fact; auto-folding is a soft auto-hide the sponsor rejected. (§4.) |
| **Q3** | Session **UUID** — keep as a small muted trailing chip (recommended), or move to a tooltip-only on the title? | **Muted trailing chip.** It's load-bearing for grepping JSONLs/logs; tooltip-only costs a hover each time. (§5.3.) |
| **Q4** | Add a **"hide dead sessions"** control? | **Yes — opt-in, default OFF, with a collapsible `⊘ N dead [▸]` count group** so window-reload tombstone-duplicates can fold without losing the audit trail. New scalar `claudeteam.hideDeadSessions`. (§6.3.) |
| **Q5** | **Remove agent** — direct host-write to `teams.yaml` (A) or guided manual edit (B)? | **(B) guided manual edit.** Keeps the extension read-only against sponsor config (V1 read-only thesis); avoids lossy YAML rewrites. (§7.3.) |

---

## 11. Out of scope / guardrails (V1 of this epic)

- **No auto-hide / auto-prune by inactivity.** Sponsor REJECTED (DECISIONS §36). Hide + remove are explicit only. Dead-prune stays file-driven.
- **No per-state sprite beyond idle-pool/working/reading.** No dedicated error/finished sprites in V1 (idle-pool covers them; dot+overlay carries semantics).
- **No agent control surfaces.** Hide/remove are VIEW + ROSTER concerns, not start/stop/message (read-only thesis stands).
- **No sprite generation at runtime.** Webview plays harvested frames only; PixelLab is an authoring-time orchestrator concern.
- **No background-noise change.** Unrostered agents still collapse to the count chip.
- **No new framework.** Vanilla TS webview (decided M2). Sprite player is a small hand-rolled frame sequencer, not an animation library.
- **No multi-color-per-member / per-state member color.** Running-dot member color only (86c9zmyef §6 guardrail stands).
