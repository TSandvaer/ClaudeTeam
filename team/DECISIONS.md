# Decisions Log

Append-only chronicle of team-level decisions on ClaudeTeam. One decision = one entry. Newest at the top. Decisions LIVE here on disk — they do not persist in conversation memory.

**Scope:** project-level / process-level decisions that affect future sessions or other roles. Not for code-level micro-decisions (those live in commit messages and PR bodies).

**Distinction from `.claude/decisions-while-away.md`:** that file captures autonomous orchestrator decisions made under user-global "Orchestrator autonomy" gates, with status tracking (`pending review` / `accepted` / `reversed`). This file (`team/DECISIONS.md`) is the broader team chronicle — including decisions the sponsor made directly, structural choices ratified in conversation, retro-driven changes, etc. An entry can cross-reference a decisions-while-away entry when applicable.

**Entry format:**

```
## YYYY-MM-DD — <one-line decision headline>

**Decided:** <what>
**Context:** <why this came up>
**Alternative considered:** <what we didn't pick + why>
**Implication:** <what changes downstream>
**Reversibility:** <how to undo + cost>
**Pointers:** <PR / file:section / memory-name / conversation reference>
```

Append below. Newest entries at the top.

---

## 2026-05-28 — Whole-team-always-visible dashboard: full-roster baseline tiles + hide/remove agent UX (EPIC 86ca11187)

**Decided:** The dashboard's display model changes from "show detected live agents matched to the roster" to "seed a tile for the FULL roster as always-present baseline, with live state overlaid." Every teams.yaml member always renders (default idle/available) even if never dispatched; running/idle/finished/error overlays when detected. PLUS two explicit USER-driven culling actions (no auto-hide):
- **Hide agent** (reversible in-UI): per-tile "hide" → member drops from default view; a "show hidden agents" toggle reveals hidden members; per-agent "show" un-hides. Persists across reloads. For decluttering long-unused members without losing them.
- **Remove agent** (yaml-gated restore): per-tile "remove" → member fully suppressed (not even under "show hidden"); returns ONLY by re-adding to teams.yaml. More permanent than hide.

This also folds in the previously-unfiled persona pixel-character → webview display integration (sprites + pose→state mapping + slow/dwell playback).

**Context:** Sponsor 2026-05-28. After the `hideIdleAgents` flip (#108) + flipping their `hideFinishedAgents` user setting, the sponsor noticed Iris/Nora/Bram still weren't shown — because the reducer (src/extension/state/reducer.ts, verified) builds tiles ONLY from detected live agents, so never-dispatched members get no tile. Without full-roster baseline rendering, "show idle"/"show finished" only ever reveal members who happened to run. Sponsor explicitly wants the full team always present + user-controlled hide/remove (NOT auto-hide-by-inactivity).

**Alternative considered:** auto-hide members after N days idle. REJECTED by sponsor — culling must be explicit user action (hide or remove), never automatic.

**Implication:** Net-new display model + state. Sequenced AFTER the M01+F01 pose set finishes (sequencing pivot). Needs Iris design spec → Felix (host: roster-baseline seeding, never-run state, hidden/removed persisted filters) + Maya (webview: sprite rendering, pose→state animation, hide/show/remove UI) → Sage tests. Will break into sub-tickets off the Iris spec. Gates: package.json (extension-manifest), webview-smoke.

**Reversibility:** Spec/feature work — reversible per-PR; epic not yet dispatched.

**Pointers:** ClickUp EPIC **86ca11187** (https://app.clickup.com/t/86ca11187); memory [[dashboard-whole-team-always-visible-thesis]]; reducer.ts (current detected-agents-only model); persona doc; assets/sprites/ClaudeTeam-M01-Dev + -F01-Dev.

---

## 2026-05-28 — Full team always displayed: flip `hideIdleAgents` default true → false

**Decided:** The dashboard must ALWAYS show the full team — all rostered members, idle or not — by **default**. `claudeteam.hideIdleAgents` default flips **`true` → `false`**. The hide-idle toggle/chip stays as a capability; only the DEFAULT changes. Ticket filed on the ClickUp board (901523520912) and dispatched to a dev 2026-05-28.

**Context:** Sponsor, 2026-05-28 (verbatim): *"I always want the full team to be displayed (idle or not)."* This is the concrete code reversal of the M5 running-focused "hide-idle-by-default" (Iris spec `86c9zmyef`, PRs #97/#98). The whole-team-always-visible thesis (DECISIONS 2026-05-27) + the persona pixel-character idle-variety work are the design justification — idle members now have visual presence worth always showing.

**Alternative considered:** Leave default `true`, rely on the sponsor flipping the chip per-session. Rejected — sponsor wants it as the standing default, not a per-session opt-in.

**Implication:** Small code change (package.json contributes default + any code-level `?? true` fallback + integration tests asserting the old default). Touches `package.json` → extension-manifest gate (vsce package in Self-Test); behavior change → webview-smoke gate (manual reload). Does NOT remove the toggle, does NOT change `hideFinishedAgents`, does NOT include the persona-character display integration (separate future ticket).

**Reversibility:** One-line default flip — trivially reversible by flipping back.

**Pointers:** memory [[dashboard-whole-team-always-visible-thesis]]; package.json:126-129 (`claudeteam.hideIdleAgents`); `src/extension/state/hideIdleFilter.ts`; tests/integration/watcherLoop.test.ts (~635/646 assert old default); Iris spec `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` §3.2.

---

## 2026-05-28 — Sequencing pivot: depth-first on M01+F01 (many idle poses) → extension display → THEN more variants

**Decided:** Stop breadth-first roster expansion. The new sequence is: (1) **finish only M01-Dev + F01-Dev**, giving each a **much larger idle-pose pool** (well beyond the current coffee/snack/stretch/phone/hips set); (2) **build the extension** so it displays these characters and their pose-animations correctly (random idle-pool pick, working on tool≠Read, reading on tool==Read, slow+dwell render); (3) **only once the extension displays them correctly** does the roster expand to more character variants (M02-M05, F02-F05). **M02-Dev is PAUSED as a deferred variant** (4 poses approved: coffee/reading/snack/stretch; preserved on PixelLab, not finished).

**Context:** Sponsor stated mid-M02-build (2026-05-28): *"I only want to finish M01 and F01, they will have a lot more idle poses before i want to try them out in the extension. then when the extension can display them and display them correctly then ill move on to create more variants."* Rationale: prove the end-to-end display path on two well-developed characters before investing gens in 8 more — de-risks the extension integration and avoids building a large roster that might need rework once the display reveals issues.

**Alternative considered:** Finish the full 10-char roster first (the prior plan), then build the extension. Rejected by sponsor — too much asset investment ahead of a working display path.

**Implication:** Next persona work = propose + build a larger idle-pose set on M01 + F01 (orchestrator proposes the set, sponsor picks). The webview-integration ticket (Maya) moves UP in priority — it's now the gate before any further characters. M02's remaining poses (phone/hips/working) + harvest/commit are deferred until variants resume; M02 state UUIDs are recorded in STATE.md for clean resume.

**Reversibility:** Pure sequencing/priority change — fully reversible by resuming M02 / roster expansion at any time. M02's PixelLab states persist server-side.

**Pointers:** STATE.md resume header (2026-05-28 ~19:xx UTC); memory [[project-claudeteam-overview]] + [[dashboard-whole-team-always-visible-thesis]]; persona doc `.claude/docs/persona-pixel-character-animation-prompts.md`.

---

## 2026-05-28 — State-per-pose is the standard for persona character animations

**Decided:** Every persona pose — idle (coffee), eating a snack, stretching, on the phone, hands-on-hips, working at a computer, reading — is built as its own PixelLab **character state** (`create_character_state`), NOT as an animation queued directly on the base character. Each state bakes the pose (and any prop) into the character's reference rotation; the animation on that state is then ONLY the small residual motion (throat swallow, jaw, typing fingers, head scan). A character is therefore a GROUP: the base standing character (roster portrait) + one state per pose, each state carrying exactly one residual-motion animation.

**Context:** While fixing M01-Dev's `reading` animation 2026-05-28, the sponsor observed the book re-raising every loop. Root cause: a v3 loop cannot hold a one-time setup — the loop wrap re-runs any transition verb (raise book, raise cup, sit down) and the held pose collapses back to the arms-down standing reference between cycles. The two-entity fix (book-up state + head-only loop) worked, and the sponsor generalized it: "maybe all the poses ... should all be states?" The `working` pose independently confirmed it — animating "sitting at a desk" on the standing base made the desk rise out of the ground each loop ("the table is sucked up from the ground").

**Alternative considered:** Keep animating poses on the base character with stricter "once at the start / stays still" prompt language. Rejected — it fights prompt-literalism per-pose, per-character, ten times over; the held pose still collapses to the reference between cycles; and it cannot reliably suppress setup verbs (book/cup/desk). State-per-pose removes the failure at the source.

**Implication:**
- ~190 gens for the full 10-char roster (10 base + 70 states + 70 anims + ~40 re-roll buffer) vs. the earlier ~115 estimate — still ~10% of Tier-1's 2000/mo. Re-roll churn should drop because the pose is locked.
- M01-Dev's existing base-character anims (coffee idle approved + 5 pending idles + working) are being rebuilt as states. The bad first reading attempts (`reading` anim on base `7282cc3d`; state `7b6a974b`) are scheduled for deletion.
- Identity-consistency watch-item: each state re-synthesizes the sprite, so appearance can drift slightly between a character's own poses. Mitigation: `use_color_palette_from_reference=true` for non-prop poses (stretch, hips, working); accept minor drift on prop poses at 68px.
- Webview reverse-map must pull each pose's anim from its sibling state folder (keyed by `metadata.json` `group_id → states[]`), not from one folder.
- `auto-pixellab` queue (built to animate one character) needs a `create_character_state` step added per row before it can batch state-per-pose; until then, drive manually.

**Reversibility:** Architecture choice for asset generation only; no production code committed yet. Per-state gens are sunk but PixelLab retains everything. Reverting = animate poses on the base char instead (and accept the failure modes this avoids). ~0 code to undo.

**Pointers:** [.claude/docs/persona-pixel-character-animation-prompts.md](../.claude/docs/persona-pixel-character-animation-prompts.md) (§ Architecture: state-per-pose, § Per-pose recipes — full state+residual prompts); supersedes the base-character animation approach in the 2026-05-27 entry below; sponsor messages 2026-05-28 (this orchestrator session); M01-Dev base `7282cc3d-f822-492c-a790-08b3b5d2b27e`, corrected reading state `7d32de45-e4a9-4f09-b603-694b9c65a927`.

## 2026-05-27 — Persona pixel characters replace color dots + dashboard whole-team always-visible thesis

**Decided:** Personas on the dashboard will be represented by **pixel characters with multiple idle animation variants**, not just a colored dot. Sponsor's design north star is **whole-team always-visible** — every persona renders on the dashboard regardless of working state. The hide-idle-by-default code behavior shipped in M5 (PRs #97 + #98) **narratively reverses** under this thesis (the code default stays `true` for now; sponsor toggles their personal `hideIdleAgents` setting OFF via the header chip). Idle variety per character — 3-5+ distinct idle poses such as coffee sip, eating a snack, stretching, scrolling phone, hands on hips — is the **mechanism** that justifies always-on display; a single repeated idle pose would feel dead against continuous visibility. Plan: 5 male + 5 female unique pixel characters (25-40-year-old IT office employees), random assignment initially, sponsor-selectable later. Per-char animations: idle pool (multiple variants for the always-visible context) + sit-at-computer (any tool ≠ Read) + reading-book (tool == Read). Source-of-truth pipeline: PixelLab MCP (orchestrator-only — sub-agents lack permission per [randomgame `pixellab-pipeline.md`](../../RandomGame/.claude/docs/pixellab-pipeline.md)), `low top-down` view at size 48 / 4 directions / standard mode (1 gen/char), v3 custom animations south-only (1 gen/anim) to conserve credits. Workflow: create character → sponsor approves → animations one-by-one → sponsor approves each → next character.

**Context:** Sponsor initiated 2026-05-27 mid-session ("instead of representing personas with a color (dot) I want each persona to have a pixel character"). After approving M01-Dev and the first idle (coffee sip) variant, sponsor expanded scope: "i want two or three idle poses so the character doesnt drink coffee all the time" — followed by the foundational reasoning: "the reason why i want so many idle poses is because i want to display the whole team at all times (i know im going back on not show idle)." The thesis is what makes the variety load-bearing rather than gold-plating: variety is *required* for an always-visible tile.

**Alternative considered:** (a) Static character portraits (no anims) — ruled out; defeats the always-alive intent. (b) Single idle anim per character — ruled out per sponsor reasoning above. (c) Keep color dots, add character avatars only on hover/tooltip — sponsor explicitly chose pixel characters as the primary visual.

**Implication:**
- New asset library at `assets/personas/<name>/` (path TBD when Maya wires the webview integration). Approx. 50-100+ PixelLab generations needed for full roster (10 chars × ~1 base + 5-7 anims south-only). Well within Tier 1's 2000/mo budget; ~1636 remaining at session start.
- Webview integration (future ticket, likely Maya): persona-card tile renders the character sprite; selects an idle variant on a rotation/random basis; flips to `working` anim during tool use ≠ Read; flips to `reading` anim during Read tool use.
- Sponsor-selectable character UI (post-V1): user assigns specific characters to specific personas.
- Hide-idle code default likely flips to `false` when persona characters ship as the default rendering — track separately; do not unilaterally change.
- Per [pixellab-pipeline.md](../../RandomGame/.claude/docs/pixellab-pipeline.md) constraints: hand-object continuity not preserved across animation frames (small inconsistencies in coffee cup / phone / snack hand position acceptable at tile scale); animation frames only exposed via ZIP download; standard `animate_character` is ~1 gen/direction.

**Reversibility:** Asset generation cost is sunk per gen (~$0.005/gen at Tier 1) but PixelLab account retains everything. Webview integration is a future PR; reverting = revert that PR. Sponsor can opt back to color dots at any time without touching PixelLab assets.

**Pointers:** `[[dashboard-whole-team-always-visible-thesis]]` (memory); sponsor messages 2026-05-27 mid-session (this orchestrator turn); first character `ClaudeTeam-M01-Dev` PixelLab ID `7282cc3d-f822-492c-a790-08b3b5d2b27e`; randomgame project's `pixellab-pipeline.md` for tool-use conventions; no ClickUp ticket yet (file once feature scope stabilizes).

## 2026-05-23 — M2 absorbs M3's roster-render (Option A); M3 renamed to "Roster config + live refresh"

**Decided:** M2's "Extension scaffold" milestone consumes the already-merged M1-08 roster matcher in the webview render path. V1-PLAN.md's M3 milestone is narrowed from "Load `teams.yaml`, apply matchers, render named tiles vs background bucket" to "Roster config + live refresh" (interactive roster-config UI, live YAML watching, drill-in polish).

**Context:** V1-PLAN.md was authored before the M1 backlog crystallized; the matcher landed in M1-08 (PR #10) ahead of where V1-PLAN had it scoped. Nora's M2 backlog (PR #16) surfaced the resulting M2/M3 scope-overlap as a sponsor-pending decision. Sponsor confirmed orchestrator's recommendation today.

**Alternative considered:** Option B — keep M2 strictly "hardcoded strings" per V1-PLAN's letter; defer matcher consumption to M3. Rejected — ships a throwaway webview at M2-end that gets ripped out at M3-start; ~0.5-1 day of avoidable churn for no benefit, since the matcher is already live and tested (28 tests, M1-10 integration coverage).

**Implication:** Nora's M2 backlog (PR #16) is written for Option A; no re-author needed. M2-05 (Maya webview tile renderer) and M2-06 (Felix host integration) consume `DashboardState` from the live matcher via the reducer. M3 milestone description in V1-PLAN.md will be updated by Nora as part of M2-09 (dispatch-template tightening) or a separate M3-planning ticket.

**Reversibility:** Backing out is one PR to delete the matcher import from `src/extension/messageBus.ts` (M2-06) and revert M2-05's data wiring. ~30 min effort. No external system touched.

**Pointers:** `.claude/away-queue.md` "2026-05-23 1330 UTC — M2/M3 scope-overlap" (now `answered`); `team/nora-pl/milestone-2-backlog.md` § scope-overlap note; PR #16; PR #10 (M1-08 matcher); `docs/V1-PLAN.md` § V1 milestones table (pending M3 description update).

---

## 2026-05-23 — Adopt RandomGame-style bloat-prevention bundle (this session)

**Decided:** Import three coordination patterns from RandomGame + MarianLearning that ClaudeTeam was missing: (1) `team/log/process-incidents.md` as the append-only failure-mode chronicle (vs growing `.claude/docs/orchestration-overview.md`); (2) `team/STATE.md` as the between-tick source of truth (replaces ad-hoc re-derivation from conversation history); (3) `team/DECISIONS.md` (this file) as the team-decisions log; (4) `.claude/retros/` directory for milestone retros.

**Context:** Sponsor surfaced that the main session was at risk of context bloat. Survey of two sibling orchestrated projects on the machine confirmed both had explicit anti-bloat scaffolding ClaudeTeam lacked. The `.claude/docs/orchestration-overview.md` file is loaded at every SessionStart via the docs-preload hook — failure-mode entries accumulating there is an ever-growing context tax on every future session.

**Alternative considered:** (a) leave the current structure; rely on the maintain-docs Stop hook + auto-memory to keep `.claude/docs/` lean. Rejected — maintain-docs explicitly does not prune (its job is to add), and `.claude/docs/` is the EAGERLY-loaded surface where lean matters most. (b) Stuff everything into `.claude/decisions-while-away.md`. Rejected — that file is for orchestrator-autonomy audit, not team-wide decisions; conflating the two muddies the audit signal.

**Implication:** Future SessionStart context-load shrinks because `orchestration-overview.md` only carries stable patterns (not historical failures). Orchestrator resume reads `team/STATE.md` instead of replaying the last save-session file or re-deriving from conversation. Retros at milestone boundaries (starting with M1's close) become the durable lesson-promotion ritual.

**Reversibility:** ≤1 PR to revert (delete the three new files + re-inline the failure-mode entries back into orchestration-overview.md). Effort: ~20 min. No external system touched.

**Pointers:** This commit (orch-doc bundle landing on `main`). Survey notes: RandomGame `team/STATE.md`, `team/log/process-incidents.md`, `.claude/retros/`; MarianLearning `.claude/agents/dispatch-template.md` § Final-report shape with the explicit "context-bloat is the dominant surface" rationale.

---

## 2026-05-23 — Sponsor doesn't review PRs; team peer-reviews + QA + orchestrator admin-merges

**Decided:** ClaudeTeam's PR gate is fully internal to the team: peer-review (cross-pair Felix↔Maya, Iris→Maya/Felix, Sage→Felix/Maya, Bram/Nora→orch-direct) + Sage QA on AI-testable surface + orchestrator admin-merge after gates clear. Sponsor only signs off sponsor-domain calls (strategic priority, externally-visible actions, billing) — not individual PRs.

**Context:** Bootstrap default assumed sponsor approved each PR pre-merge. Sponsor clarified explicitly that they trust the team's review loop and want PR throughput unblocked.

**Alternative considered:** Sponsor-gates every PR (default for many projects). Rejected — bottleneck on sponsor + cost of disrupted flow exceeded the safety win for a team that has cross-review + QA discipline + admin-merge audit trail.

**Implication:** Orchestrator merges autonomously once gates clear. Sponsor input reserved for sponsor-domain calls. Memory: `[[sponsor-doesnt-review-prs]]`.

**Reversibility:** trivial — orchestrator re-routes merge sign-off through sponsor on request. Effort: 0 min (just changed instructions).

**Pointers:** Conversation 2026-05-23 mid-session; captured in memory `feedback_sponsor_doesnt_review_prs.md`; referenced in `CLAUDE.md` § Autonomy.

---

## 2026-05-23 — `AgentMeta` is a 3-tag union (v2.1.119 + v2.1.145-general + v2.1.145-persona)

**Decided:** Bram's M1-02 probe surfaced a third meta.json schema variant beyond the documented v2.1.119 / v2.1.145 pair: a persona-named v2.1.145 variant with `agentType: <persona-slug>`, `toolUseId` present, no `name`. Observed in 5 of 10 real captures. The `AgentMeta` discriminated union is 3-tag (`schemaVersion: "v2.1.119" | "v2.1.145-general" | "v2.1.145-persona"`).

**Context:** M1-02 fixture capture; M1-05 meta.json parser must handle the variant first-class. Without first-class typing, downstream code would silently misroute persona-named agents into background.

**Alternative considered:** Treat persona-named as a sub-mode of v2.1.145-general (single tag). Rejected — the field-presence delta (`toolUseId` present, no `name`) is structural and the matcher needs to dispatch on it.

**Implication:** Felix widened the union in PR #11 (M1-05). Matcher (PR #10, M1-08) is intentionally schemaVersion-agnostic so the widening is type-only and doesn't break downstream code.

**Reversibility:** narrow back to 2-tag is a typed migration touching ~5 files. Effort: ~30 min. No external system touched.

**Pointers:** `.claude/docs/data-sources.md` §4 (three-variant schema table); `src/shared/types.ts` `AgentMetaSchemaVersion`; Bram's `team/bram-research/m1-fixtures-2026-05-23.md`.

---

## 2026-05-23 — ClickUp MCP tools are NOT surfaced to sub-agent runtimes (permanent harness gap)

**Decided:** Orchestrator owns all ClickUp writes. Sub-agents append intended status transitions to `team/log/clickup-pending.md` under the canonical `## Status-flip queue (sub-agent dispatch fallback)` section; orchestrator flushes on each tick.

**Context:** Persona declarations include `mcp__clickup__*` tools, but Bram's probe (PR #2) confirmed the Claude Code harness filters these from sub-agent runtime — same filtering pattern as the `Agent` tool. This is structural, not a transient outage.

**Alternative considered:** (a) Have personas surface intended transitions via final-report text + orchestrator flips on parsing them. Rejected — fragile parser, no canonical pending state. (b) Wait for harness fix. Rejected — no ETA; fallback is needed regardless.

**Implication:** Every dispatch brief's ClickUp lifecycle block tells the persona about the fallback. Orchestrator flushes the pending queue each tick. Canonical section name codified in dispatch-template.md to prevent merge conflicts (see process-incident "Divergent section headers in clickup-pending.md").

**Reversibility:** if/when harness exposes ClickUp MCP to sub-agents, retire the pending queue and have personas flip directly. Effort: dispatch-template edit + queue-flush + remove the fallback section.

**Pointers:** `.claude/docs/orchestration-overview.md` § ClickUp as hard gate; PR #2; `team/bram-research/probe-clickup-mcp.md`.

---

## 2026-05-23 — Auto-merge orchestration-doc PRs from Nora's lane (no sponsor pre-approval)

**Decided:** PRs touching `team/` planning artifacts (backlogs, decisions logs, role docs, status docs) authored from Nora's worktree merge straight to main after orchestrator review — no per-PR sponsor approval.

**Context:** Backlog and coordination-doc PRs are routine workflow artifacts. Sponsor's bandwidth is finite; routing every doc PR through sponsor review created stalls without adding signal.

**Alternative considered:** Route all `team/` PRs through sponsor for sign-off. Rejected — same bandwidth math as the broader "sponsor doesn't review PRs" decision; no incremental safety vs cost.

**Implication:** Orchestrator merges Nora PRs after gates (no peer-reviewer required for pure planning artifacts unless the PR touches files other roles depend on).

**Reversibility:** trivial — re-route via sponsor on request.

**Pointers:** `CLAUDE.md` § Autonomy; cross-references `[[sponsor-doesnt-review-prs]]`.

---

## 2026-05-29 — Persona pixel-characters assigned by gender (M01=male, F01=female); roster expansion deferred

**Decision (sponsor, /sponsor-questions-walkthrough):** Verbatim — "use the same M01 for all male agents and F01 for all female agents. I will generate a lot more characters to choose from later."

**Implication:** No bespoke per-persona character commissioning for now. The two existing Dev sprites are shared by gender across the whole roster: every male-presenting persona → `ClaudeTeam-M01-Dev`, every female-presenting persona → `ClaudeTeam-F01-Dev`. `MEMBER_SPRITE_BINDING` in `src/webview/sprites/spriteManifest.ts` gets an entry for ALL six members (was 2). Sponsor will generate a larger character library later and reassign per-persona at that point.

**Note:** This corrects the provisional binding (`felix→F01-Dev`, `maya→M01-Dev`) which had Felix on the female char — gender mapping per persona is the Q3 follow-up in the same walkthrough.

**Reversibility:** one-line-per-member edit in `spriteManifest.ts`; trivial to reassign when the larger library lands.

**Pointers:** `[[project_dashboard_whole_team_thesis]]`; spriteManifest binding `src/webview/sprites/spriteManifest.ts:59`; walkthrough 2026-05-29.

---

## 2026-05-29 — Read state uses "read-at-screen" (desk posture), book-reading moves to idle pool

**Decision (sponsor):** The active Read state (tool==Read during a working session) renders a NEW "read-at-screen" animation — the working desk posture (hands on keyboard/mouse) with the head scanning left→right — INSTEAD of the book-reading pose. Always desk-read in active sessions (not conditional). The existing book-reading animation is REPURPOSED into the idle_* pool (a "reading a book" idle variant), so it only shows while idle (rotation expected, not jarring) and is not wasted.

**Why:** during active sessions the tool alternates Read / non-Read, which flipped the character between book-reading and desk-working postures repeatedly — visually jarring. Both working and read-at-screen are desk postures → zero posture flip.

**Implementation:**
- PixelLab (orchestrator-only, gated): generate `read_at_screen` for M01 + F01 — desk posture like `active_work`, head L→R scan, hands locked on keyboard/mouse.
- Webview (Maya): pose→state map — `active_read` → `read_at_screen` in active sessions; add the old book anim to the `idle_pool` (new canonical name e.g. `idle_reading_book`); update animations.json for both chars.

**Pointers:** [[project_persona_character_gender_binding]]; persona doc .claude/docs/persona-pixel-character-animation-prompts.md; pose-iteration workflow [[feedback_persona_anim_iteration_workflow]]; ticket filed 2026-05-29.
