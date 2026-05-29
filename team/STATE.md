# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-29 (RESUME; sponsor walkthrough — dispatching E-07b + E-09)

**Resume next-action:** Walkthrough done; **2 agents in flight (dispatched 2026-05-29 ~mid-day):**
- **Maya → E-07b DONE → PR #120** (`86ca1agc5`, head `820c460`). Remove affordance (in-tile confirm → `ui:remove-member`), `removedMemberKeys` masked from show-hidden via set-diff in `render.ts`, 6-member gender binding fixed. 932 unit/121 integration green; `messageReceiver.ts` untouched (webview→host only — flagged in PR body). **Felix reviewing → agentId `a8376e75a1bf29ec6`** (branch checked out in felix-wt via `gh pr checkout 120`). ClickUp flips queued in `team/log/clickup-pending.md`.
- **Sage → E-09 DONE → PR #121** (`29df816`). Ticket **`86ca1c1az`** created by orch (Sage lacks create_task), status `in review`, ID backfilled to PR #121. Test plan `team/sage-qa/epic-86ca11187-test-plan.md` + `tests/integration/noAutoCullPipeline.test.ts` (3 pass). 919 unit/124 integration green. E-07b webview-remove checks + 6-member-binding re-confirm marked **re-run-after-PR-#120-merge**. **Felix review QUEUED behind PR #120** (single felix-wt — do NOT dispatch Felix twice). Reviewer Felix (host/pipeline surface).

On staleness check: `SendMessage`-by-ID (Felix `a8376e75a1bf29ec6`) + `git fetch && gh pr list --author "@me"`. **Sequence:** (1) Felix finishes PR #120 review + detaches → on APPROVE + CI green, admin-merge #120, flip `86ca1agc5` → complete. (2) THEN dispatch Felix on PR #121 review. (3) On APPROVE + CI green, admin-merge #121, flip `86ca1c1az` → complete → **epic 86ca11187 closes** (E-08 deferred OUT). All merges per rule 6.6 #1. auto-status OFF (do not re-arm unless sponsor asks). main = origin/main = `bcf6ea1`. **GUI test remains sponsor-only** (rebuild .vsix). Pending cleanup (not yet done): `git rm team/maya-dev/scratch/pr3-review.md`; NITs `86ca16gb7` + E-01 factory.

**Walkthrough decisions (2026-05-29):** Q1 dispatch-now (done). Q2 persona chars by gender, no bespoke commissioning yet ([[project_persona_character_gender_binding]] + DECISIONS.md). Q3 Sage→F01-Dev (female). Binding fix folded into E-07b.

---

## Current state — 2026-05-29 ~08:33 UTC (AWAY-MODE; Epic 86ca11187 Wave 0 DONE, Wave 1 in flight)

**Resume next-action:** Away-mode active (cron `dfa42db3`, 15m tick). EPIC 86ca11187 **Wave 0 DONE** (E-01 #114 + E-02 #113 merged → complete; E-03 spec = #109 merged). **Wave 1 IN FLIGHT** (dispatched ~08:33 UTC):
- **Maya → E-04** `86ca191uy` persona sprite rendering · agentId `a760aab80ec875b2f` · branch `maya/86ca191uy-persona-sprites`. Owns `agentTile.ts`; reviewer Felix.
- **Felix → E-06a** `86ca191yz` hide-agent HOST (persisted hidden-set + filter + msg types) · agentId `a0d34a9c1ff0c6554` · branch `felix/86ca191yz-hide-host`. Authors vocabulary (`HiddenMemberKey`, `ui:hide-member`/`ui:show-member`/`ui:show-all-hidden`) for E-06b; reviewer Maya.
On their PRs: Felix↔Maya cross-review, green CI, admin-merge + ticket→complete. **Webview serialization:** E-04 owns `agentTile.ts` → E-05 (baseline skin) + E-06b (hide controls) REBASE onto E-04 (don't parallel-dispatch a 2nd webview agentTile.ts task). Next after E-04 merges: E-05 (baseline skin), then E-06b (hide webview), then E-07 (remove), E-09 (Sage QA).

**Still to do (away-mode):** merge/close open PR #110 (Nora backlog doc — STATE.md conflict vs merged #109; low value now, tickets created — consider closing); create remaining epic tickets E-05/E-07/E-09 (E-08 deferred/OUT) as waves approach. NITs: `86ca16gb7` (#111 docs) + #114 NITs (makeBaselineTile factory de-dup + AC5 prose) — fold into a reducer-touch.

**SHIPPED this session:** idle-debounce 10s→60s (#111 / `86ca168j9`); settings gear (#112 / `86ca16r2d`); Iris epic design spec (#109); M01+F01 full 15-pose set harvested+committed+pushed (`51c2564`) + canonical `animations.json` naming (idle_* / active_work / active_read). NITs follow-up `86ca16gb7` (to do). PixelLab stray `70e39b6d` for sponsor to delete in UI (optional).

**QUEUED for sponsor (return):**
- **Persona→character face-map binding** (from E-04 #116): currently PROVISIONAL `felix→F01-Dev`, `maya→M01-Dev` — only 2 generic "Dev" sprites exist, no sponsor-locked face map. One-line edit in `spriteManifest.ts`. Decide which persona shows which character (and whether to commission more PixelLab characters for the other roster members — currently Sage/Iris/Nora/Bram degrade to text tiles).
- **GUI test** once Wave 0/1 yields an installable `.vsix` rendering the always-visible roster + persona tiles (sub-agent GUI gap — only sponsor visually confirms).
- E-08 DEAD-toggle defaulted OUT/deferred. Two unbuilt code improvements on main (idle-60s + gear) need a rebuild+reinstall to see — batch with epic.

**New idle-pose progress (state UUIDs; NONE harvested to disk yet — PixelLab only):**
- idle_think — DONE both: M01 `ec0293a9-e3e9-4545-8e21-b11391ac1d23`, F01 `32b6afd4-d669-439f-b003-766cd6d96e02` (F01's was best; M01 re-rolled to hand-glued-to-chin)
- idle_arms_crossed — DONE both: M01 `351e29e6-9811-4a50-8c9f-bb8fefc99bc0`, F01 `96ce82b0-fb16-44b5-9e4c-6937f03a35ce` (full-sweep symmetric head-look fixed the center→right-only issue — generalizes the reading symmetry fix)
- idle_pockets — DONE both: M01 `b30068bf-cb1d-492f-8b0f-948c0661b798`, F01 `88c4cc9b-63aa-40b5-b4ae-060f157eac40`
- idle_neck_roll — DONE both: M01 `52d38a23-e5eb-446e-b04b-e119792a01b8`, F01 `dd0b4160-d0bd-4a09-8cd3-5e0bc44522d5`
- idle_yawn — M01 DONE `e80413dd-9e8f-41da-8657-4247f0046606`; F01 motion AWAITING GATE on `8c7222d2-a503-4037-96b5-edad8cf5ff4c` (upright re-roll — first F01 yawn `0cd018a9` was deleted for hunched/wrong-angle; keep yawn UPRIGHT, no head-tilt-back)
- **REMAINING (not built): idle_watch, idle_headphones, idle_wave** on both. Recipes drafted in prior wakeup prompts: idle_watch state "raising one forearm with the wrist turned up to read a wristwatch, head tilted down slightly" + residual head-glance; idle_headphones (prop=headphones, palette OFF) head-bob to music; idle_wave (gesture) friendly wave.
- **THEN: consolidated harvest** — re-download M01 + F01 group ZIPs (now include all new states) to `assets/sprites/ClaudeTeam-M01-Dev/` + `ClaudeTeam-F01-Dev/`, prune any `(copy)` strays first, commit. (The new idle poses are NOT yet on disk — only the original 7 poses are in the committed harvests.)

**Pose gotchas validated this arc:** symmetry full-sweep wording ("first turns clearly to the LEFT … all the way to the RIGHT … just as far left as right", fc=10) fixes center→right-only on ANY head-look pose; idle_think hand must be glued to chin (head+arm tilt together, no slide); yawn must stay UPRIGHT (tilt-back caused a hunched/foreshortened render on F01); feet planted for standing poses (lock legs to avoid walking).

**EXTENSION — full-team flip SHIPPED:** PR #108 merged (`hideIdleAgents` default true→false), ticket 86ca10anf complete. This session also flipped the sponsor's VS Code USER setting `claudeteam.hideFinishedAgents` true→false (was hiding finished agents — that was why only Maya showed). Local `main` reconciled: rebased the 8 persona/orch commits onto origin/main (has #108); **8 ahead / 0 behind, UNPUSHED** (push only if sponsor asks). Sponsor still to: reload window (done) / rebuild .vsix from current main for a clean packaged default.

**EPIC 86ca11187 filed (NOT dispatched):** whole-team-always-visible dashboard — full-roster baseline tiles (seed a tile per roster member; reducer currently only builds from detected agents → Iris/Nora/Bram absent) + persona pixel-char rendering + hide-agent (reversible) + remove-agent (yaml-gated). Sequenced AFTER the M01+F01 pose set. Open offer to sponsor: dispatch Iris's design spec in PARALLEL with remaining poses (Iris worktree free, no PixelLab conflict) — sponsor invoked drain before answering.

---

## Current state — 2026-05-28 ~19:15 UTC (SEQUENCING PIVOT — M02 PAUSED; next = propose larger idle-pose set for M01+F01, then extension display)

**Resume next-action:** **Sponsor pivoted to depth-first** (see [team/DECISIONS.md](DECISIONS.md) 2026-05-28 "Sequencing pivot" + memory [[dashboard-whole-team-always-visible-thesis]]): finish ONLY M01+F01 with a much larger idle-pose pool → build the extension to display them correctly → THEN more variants. **Immediate next action: orchestrator proposes a SET of new idle-pose ideas** (beyond coffee/snack/stretch/phone/hips) for sponsor to pick from, then build the approved ones on BOTH M01 (`7282cc3d-f822-492c-a790-08b3b5d2b27e`) and F01 (`f8f5708f-1364-4908-838a-4ab200cb0aff`). Reading recipe is SOLVED + persisted to persona doc + memory (book UP at chest + head bowed fully down + full-sweep anim prompt + fc=10).

**M02-Dev PAUSED (deferred variant)** — base `7f65dc76-da9e-4e57-9926-d094077ef98b`, group `77112ef7-dd4b-4495-8689-4cf5c9ca551c`. 4 poses approved + preserved on PixelLab (NOT committed to repo, NOT harvested): coffee/idle `cfa026c7-d043-4dbe-94cb-bfe7bd82e5e1`, idle_snack `5d086aa9-5f59-436c-8f53-2327d61aace1`, reading `a044facb-7337-48ca-b835-519ca0319986`, idle_stretch still-pose `62fd03a9-4d7b-45be-b619-e87b23c96f16` (its idle_stretch anim was rendering when paused — gate it on resume). Remaining if resumed: idle_stretch motion, idle_phone, idle_hips, working, then prune `(copy)` strays + harvest to `assets/sprites/ClaudeTeam-M02-Dev/` + commit.

PixelLab orchestrator-only; gate EVERY still pose + motion via AskUserQuestion (sponsor clicks approve/reject); auto-loops OFF. `.scratch/m02-analysis/` (gitignored) holds the reading analysis brief+frames.

**DEV TRACK — ticket 86ca10anf (full team always displayed): DONE + SHIPPED.** PR #108 **MERGED** to main (squash, branch deleted; mergedAt 2026-05-28T18:59:58Z). Maya APPROVE + Sage QA PASS (Sage reverted the default to confirm the test catches the regression class) + CI green. ClickUp 86ca10anf → **complete**. The `hideIdleAgents` default is now `false` on main — full team (idle or not) shown by default. **Sponsor-side post-merge action: rebuild `.vsix` (`vsce package`) + re-install to see it** (webview-smoke visual reload was deferred per sub-agent GUI gap). NOTE: local `main` (orchestrator root) has unpushed persona commits and now DIVERGES from origin/main (which has the PR #108 squash) — reconcile via rebase before any future push of persona work. Still-needed future ticket: persona pixel-character → webview display integration (NOT yet filed). Separate future ticket still needed: persona pixel-character → webview display integration (NOT yet filed).

**(prior) Resume next-action:** **F01-Dev COMPLETE** — all 7 pose-state anims sponsor-approved (coffee/`idle`, reading, idle_snack, idle_stretch, idle_phone, idle_hips, working), consolidated harvest at `assets/sprites/ClaudeTeam-F01-Dev/` (99 PNGs), committed `671be31` (feat) + `b28198a` (docs: (copy) stray-state gotcha). Working tree CLEAN; nothing pushed (push only if sponsor asks). Base char `f8f5708f-1364-4908-838a-4ab200cb0aff`, group `6603010c-...`. **Next = sponsor picks the next character (M02 or F02)** per the roster-variety plan (vary hair/skin/clothes/build); same 7-pose state-per-pose set; recipes in [.claude/docs/persona-pixel-character-animation-prompts.md](../.claude/docs/persona-pixel-character-animation-prompts.md). PixelLab orchestrator-only; gate EVERY still pose + motion; slow+dwell is a render setting (never add frames); enumerate group + prune `(copy)` strays before harvest; auto-loops OFF (do not re-arm without sponsor instruction).

---

## Current state — 2026-05-28 ~13:55 UTC (M01-Dev shipped; F01-Dev IN PROGRESS 2/7 anims; session drained+saved)

**Resume next-action:** Building **F01-Dev** (2nd persona, first female) via state-per-pose. Base char `f8f5708f-1364-4908-838a-4ab200cb0aff` (ClaudeTeam-F01-Dev: late-20s female dev, olive cardigan, dark curly hair, medium-brown skin, no glasses) sponsor-APPROVED. PixelLab group `6603010c-19e8-4b5a-a50a-2230e834dfc5`. **Approved anims:** coffee (state `6c886bdf-867a-4d7a-a9eb-9318682e43ba`, anim name `idle`) + reading (state `03888559-ef62-44a3-9075-ec795f479229`, anim `reading`). **In flight:** idle_snack STATE `5f5ea225-61ce-4b7d-bb96-7b9f1a49e6a2` was just created (generating) — NOT yet gated/animated. **Remaining F01 poses:** finish idle_snack (gate still pose → animate jaw-nibble) → idle_stretch → idle_phone → idle_hips → working. Recipes in [.claude/docs/persona-pixel-character-animation-prompts.md](../.claude/docs/persona-pixel-character-animation-prompts.md) § Per-pose recipes. **F01 not yet harvested/committed** (PixelLab account is source of truth; harvest ONCE to `assets/sprites/ClaudeTeam-F01-Dev/` after all 7 approved, then commit `feat(persona): F01-Dev ...`). Watch for stray `(copy)` states (sponsor UI duplicates — 2 hit this session, both deleted; delete empty ones). Gate EVERY still pose; slow+dwell at render; PixelLab orchestrator-only; auto-loops OFF.

**Reading-pose hard lesson (this session):** the model NODS the head down into the book instead of left-right scanning; the fix that worked is re-rolling the STATE with the **head bowed fully down (chin to chest)** so only yaw is possible, then a symmetric center→LEFT→center→RIGHT→center anim at fc=10. Budget a state re-roll for every character's reading. Doc updated.

---

## Current state — 2026-05-28 ~11:45 UTC (M01-Dev persona character COMPLETE + committed)

**Resume next-action:** Persona pixel-character feature underway; **state-per-pose architecture adopted** (see [DECISIONS.md](DECISIONS.md) 2026-05-28 entry + [.claude/docs/persona-pixel-character-animation-prompts.md](../.claude/docs/persona-pixel-character-animation-prompts.md) for the full recipe set + gotchas). **M01-Dev is COMPLETE**: base char `7282cc3d-f822-492c-a790-08b3b5d2b27e` + 8 PixelLab states grouped under `ee57907c-...` (coffee=`idle`, reading, idle_snack, idle_stretch, idle_phone, idle_hips, working), every still-pose + motion sponsor-approved, base char's 7 stale single-loop anims deleted, consolidated harvest at `assets/sprites/ClaudeTeam-M01-Dev/` (99 PNGs), committed this session. Auto-status + auto-pixellab OFF. **Next = F01** (first female character, 25-40 IT office worker, varied hair/skin/clothes per roster-variety plan), same 7-pose state-per-pose set. No sub-agents in flight (PixelLab is orchestrator-only). Render TODO (future Maya webview ticket): all anims play SLOW + dwell/hold-before-restart; reverse-map pulls each pose from its sibling-state folder via `metadata.json`.

---

## Current state — 2026-05-27 15:47 UTC (away-tick #1 — PR #105 merged, Maya dispatched on follow-up)

**Resume next-action:** Main at `58e86b8` (PR #105 squash-merge — Felix session label resolver + gitBranch chip). Auto-status AWAY (cron `e1143d7c` firing :07/:22/:37/:52). **1 agent in flight:**

- **Maya** (`a8928c7a49cf84f75`, `maya-86ca03ym7-tool-row`) — `86ca03ym7` hide `tool:` row when absent (XS scope; sponsor dogfood observation). Reviewer: Felix. Dispatched 2026-05-27 ~15:48 UTC. Expected ~10-30 min.

**This tick (15:47 UTC):**
- ✅ **PR #105 MERGED** at `58e86b8` (Felix session label + gitBranch chip). Maya APPROVE_WITH_NITS. Local roster doc-merge auto-resolved cleanly (stash → pull → pop).
- ✅ ClickUp `86ca03nww` → complete.
- ✅ Filed NIT1 follow-up `86ca049xf` (Felix mechanical refactor — dedupe tier-resolution between `resolveSessionLabel` + `sessionBlock.ts:142-159`).
- ✅ Dispatched Maya on previously-queued `86ca03ym7` (now unblocked post-PR-#105-merge).
- 📋 NIT2 queued for sponsor (see below).

**Sponsor sign-off queue (pending review on return):**
1. **PR #105 NIT2 (Maya review):** "On dead sessions, the gitBranch chip floats between title and dead-badge via `margin-left: auto`. Visually defensible but worth sponsor-side post-merge confirm." — sponsor decides whether to tighten the layout when rebuilding to dogfood.

**Auto-decisions logged this tick (per autonomy rule):**
- Merge PR #105: rule 6.6 #1 routine impl + peer APPROVE_WITH_NITS + CI green.
- File NIT1 follow-up `86ca049xf`: rule 6.6 #4 mechanical NIT scope.
- Dispatch Maya `86ca03ym7`: previously sponsor-authorized; gating dependency (PR #105 merge) cleared this tick.

**Backlog (other tickets — all to do, not blocking):**
- `86c9ztzz7` Maya PR #98 NITs (3 mechanical) — already complete via PR #101 (prior session). Verify ticket state; may already be flipped.
- Worktree state: Maya-wt busy on `86ca03ym7`; Felix-wt + Iris-wt + Bram-wt + Nora-wt + Sage-wt idle.

---

## Current state (prior — superseded above) — 2026-05-27 07:30 UTC (resume from save — 2 parallel dispatches in flight)

**Resume next-action:** Main at `c68b84c` (PR #94 chip-label rename squash-merge — drain wave complete). Auto-status OFF (sponsor explicitly off mid-prior-session). **2 agents in flight on independent worktrees:**

- **PR #95 MERGED** at `4928838` — sponsor approved Q1-Q4 → orch-direct merge. `86c9zmyef` → complete. Downstream impl tickets filed (see below).
- **Felix** (`a9c935e285925bc59`) — ✅ DONE (despite API 529 on final-report). PR #97 opened https://github.com/TSandvaer/ClaudeTeam/pull/97 at `08:44:12Z`, MERGEABLE, CI green ×2, ClickUp `in review`. 529 hit during ≤200-word final-report generation only; all work committed at `ffd6400` on top of `4928838`. NO RETRY needed.
- **Maya** (`a6e9139d61109fb99`) — ✅ DONE. PR #96 opened https://github.com/TSandvaer/ClaudeTeam/pull/96, MERGEABLE, CI green ×2, sponsor approved 4 design defaults verbatim ("approve all 4 as recommended"): editor-tab / tick-driven auto-push / flat per-session tables / VS Code vars + hardcoded state colors.

**Recent activity (this orch round):**
- **PR #96 MERGED** at `98c9823` (Maya diag-panel). Sponsor 4 design defaults locked.
- **PR #97 MERGED** at `f7ffc1f` (Felix host plumb Pt 1) post author-rebase. Maya APPROVE pre-rebase carried through (only mechanical-arithmetic change: `subscriptionLeak.test.ts` `toBe(7)→toBe(8)` to reflect merged registerCommand count). 660 unit + green CI on rebased SHA `a091b26`. Note: local roster-matching.md had a phantom unstaged duplicate of Felix's doc change — discarded + pulled cleanly.

**Running-focused dashboard FULLY SHIPPED 2026-05-27:**
- PR #95 Iris spec → `4928838`
- PR #96 Maya diag-panel → `98c9823` (Felix APPROVE)
- PR #97 Felix host plumb Pt 1 → `f7ffc1f` (Maya APPROVE post-rebase)
- PR #98 Maya webview Pt 2 → `8529801` (Felix APPROVE_WITH_NITS, NITs filed `86c9ztzz7`)

**Sponsor next:** rebuild + reinstall vsix to dogfood:
```
npm run build && npx vsce package --no-yarn && code --install-extension claudeteam-0.0.1.vsix --force
```
Then Reload Window. Validates: persona-colored dots on running tiles, hide-idle default-on chip, "N idle hidden — show" per-team passive row, diagnostic panel (`Ctrl+Shift+P → ClaudeTeam: Open Diagnostic Panel`).

**Queued backlog:**
- `86c9ztzz7` Maya PR #98 NITs (3 mechanical: HeaderChipProps rename + postMessage cast widen + collapsed-persona forward-compat comment). XS-S, P3.
- `86c9zqa91` Iris cosmetic cleanup (line-anchor drift + halo-drop §2.5 #2 per Maya Option b). XS, P4.
- `86c9znjrg` Felix PR #92 NITs (from prior session — watcherLoop:293 comment + fixture). XS, P3.

**In flight (4 parallel — hitting the 3-5 target):**
- **Bram** (`af108f9a3ef33ecf0`) — `86c9zuqxr` tab-name feasibility triage (research only; reviewer: Felix).
**Backlog wave fully drained (5 PRs merged this round):**
- **PR #99** merged at `1d4c153` (Iris spec cleanup `86c9zqa91`) — Felix APPROVE_WITH_NITS Path 1.
- **PR #101** merged at `cfd5d1c` (Maya PR #98 NITs `86c9ztzz7`) — Felix APPROVE.
- **PR #100** merged at `c7c440a` (Felix PR #92 NITs `86c9znjrg`) — Maya APPROVE.
- **PR #103** merged at `c241782` (Iris transitive halo refs `86c9zv19a`) — Felix APPROVE.
- **PR #102** merged at `e304f5f` (Bram tab-name research `86c9zuqxr`) — Felix APPROVE.

**No agents in flight. All worktrees idle/detached.**

**Awaiting sponsor (single open question):**
- Tab-name 3 options (abandon / CLI-only ship / file follow-up Bram research investigating non-terminal label surfaces). Bram's research is now on main (`team/bram-research/86c9zuqxr-tab-name-session-card-2026-05-27.md`). Critical constraint: all 5 currently-live sessions are `claude-vscode` entrypoint — feature would be silent no-op for typical sponsor workflow. Tiny factual NIT Felix flagged (`@vscode/windows-process-tree` IS published on npm — Bram said it isn't) can fold into impl ticket if sponsor proceeds, otherwise ignored.

**This session-arc cumulative:** 9 PRs merged after session-resume (`c68b84c → e304f5f`); 0 reversals.
- **PR #99 MERGED** at `1d4c153` (Iris spec cleanup). Felix APPROVE_WITH_NITS (Path 1: accept + follow-up). ClickUp `86c9zqa91` → complete. Follow-up `86c9zv19a` filed for 2 transitive halo refs.
- **Iris** (`a3de974484096083a`, `iris-86c9zv19a-halo-refs`) — `86c9zv19a` drop transitive halo refs at §2.4 line 173 + §5.4 line 466 (PR #99 NITs follow-up). XS.
- **Felix** (`a0a04605008ed5ff8`) — ✅ DONE. PR #100 opened https://github.com/TSandvaer/ClaudeTeam/pull/100. NIT1 added 6-line comment at `watcherLoop.ts:321` (shifted from PR-#92-era :293); NIT2 swapped fixture to UUID-shape. 688 unit pass. ClickUp `86c9znjrg` → in review. Awaiting Maya peer-review (queued behind her own `86c9ztzz7`).
- **Felix peer-review of PR #99** (`a63b1e3da42fc132b`, `felix-pr99-review`) — Iris spec cleanup. Brief includes the 2-transitive-halo-refs decision (APPROVE / APPROVE_WITH_NITS + tiny follow-up / REQUEST_CHANGES expand-scope).

**Cross-pair reviewer load when PRs open (Felix is reviewer for 3, Maya for 1):**
- Felix reviews Maya's `86c9ztzz7` + Iris's `86c9zqa91` + Bram's `86c9zuqxr` — serial since one Felix-wt per task. Iris's spec-only is fastest; do that first when Felix idle. Maya's NITs second. Bram's research-PR review last.
- Maya reviews Felix's `86c9znjrg` — independent.

**Worktree state:** all 5 worktrees (bram/felix/iris/maya) occupied; nora-wt + sage-wt idle.

**Queued (not yet dispatched):**
- `86c9zqa75` Maya webview Pt 2 — depends on Felix Pt 1 merge + Maya diagnostic-panel clear. Pattern A sequencing per parallel-shared-concept rule.
- `86c9zqa91` Iris NIT2 cosmetic cleanup (XS, P4). Low priority; dispatch anytime.

**Absorbed NITs from PR #95:**
- NIT1 (halo guardrail narrative-vs-shipping gap) → absorbed into Maya Pt 2 (`86c9zqa75`) as AC5: Option a add halo to dashboard.css OR Option b drop guardrail from spec, record decision in PR body. Foundation: rule 6.6 #6 Path Y absorption (downstream ticket scheduled + files overlap; Maya touches dashboard.css for the running-dot paint).
- NIT2 (cosmetic line-anchor drift in spec §10 audit-trail) → standalone Iris ticket `86c9zqa91`. Foundation: rule 6.6 #4 (mechanical scope, file:line refs already enumerated in Felix's review).

**If this session dies right now:** next orch reads this header, checks `SendMessage`-by-ID on both agents for liveness (per "Background-agent staleness verification" rule), and `git fetch && gh pr list --author "@me"` to see if either PR opened during the gap.

**Worktree-concurrency state:** Iris-wt + Maya-wt occupied; Felix-wt + Bram-wt + Nora-wt + Sage-wt idle. Felix is the assigned reviewer for both in-flight PRs — keep his worktree free for review-checkout. Cross-pair available: Maya could review Iris's spec PR on visuals if Felix is somehow blocked, per design-PR routing.

**Prior current-state (carried — drain-and-save snapshot pre-resume):**
~~Main at `93402bf` (PR #89 squash-merge — Felix Obs 8 NITs, Maya APPROVE). Sponsor is `/auto-status away` — cron job `591c12fe` fires at :07/:22/:37/:52 each hour. **0 agents in flight.** All worktrees detached and idle (Felix, Maya, Bram, Iris, Nora, Sage). PR #88 is the SOLE open PR — Felix CODE-APPROVE clean, awaiting sponsor wording choice (A/B/C; see Sponsor sign-off queue below).~~ (Superseded — session-save `session-2026-05-27-0725-obs13-diagnostics-polish.md` captures 7 PRs merged after this snapshot; resume current at `c68b84c`.)

**Sponsor sign-off queue (write here per rule 6.4):**
1. **PR #88 wording-choice (Obs 11):** Maya's PR body lists 3 candidates — **A** `finished 5h` (compact, recommended default, currently shipped on the branch), **B** `finished 5h ago` (+4 chars, more explicit English), **C** static `finished` + tooltip-only (regresses Obs 6 — visible finish-freshness loss). Felix's review covered CODE/ARCHITECTURE only and APPROVE'd; wording is sponsor-side. Both B and C are <30-line follow-up patches if A is rejected. Merge gate.
2. **Polish ticket `86c9zfj2g`** (chip label clarity rename, e.g. `(N rostered)` → `(N active)` or similar) — sponsor names the wording before dispatch.
3. **Obs 13 IMPL dispatch** — ticket not yet filed; Bram triage shipped at PR #85; impl is Felix scope — option (b) `stop_reason=end_turn` in sub-agent JSONL → `SubagentActivity.isFinished` → reducer.ts `inferState` returns `"finished"`. Awaiting sponsor priority signal before kicking off (substantial: subagentTailer + reducer + types + integration tests + no-regression).

**Shipped this away session (2026-05-26 16:00–21:40 UTC):**

| PR | Subject | Merge SHA | Ticket | Status |
|---|---|---|---|---|
| #81 | Bram Obs 9 init-phase triage | `ebdc68d` | `86c9zbuqq` | merged |
| #82 | Felix Obs 9 misclassification fix | `6150e9f` | `86c9zc5dd` | merged |
| #83 | Bram (1 rostered) chip-label triage | `f58a6f5` | `86c9zfbpg` | merged |
| #84 | Maya Obs 8 chip state-aware | `198fc75` | `86c9zfmgg` | merged + NITs ticket `86c9zfrzt` filed |
| #85 | Bram Obs 13 background-finished triage | `c7f0e1f` | `86c9zfj83` | merged |
| #87 | Maya Obs 10 expansion preservation | `72264e7` | `86c9zfmh1` | merged |
| #86 | Felix perf JSONL dedup (~50% I/O cut) | `f443829` | `86c9zfmke` | merged |
| #89 | Felix Obs 8 NITs follow-up | `93402bf` | `86c9zfrzt` | merged |

**8 PRs merged in this away session. 0 reversals.**

**In-flight tickets:**

| Ticket | Subject | Status | PR | Note |
|---|---|---|---|---|
| `86c9zfmhp` | Obs 11 humanize elapsed-time | in review | #88 | Maya author, Felix CODE-APPROVE; sponsor wording-gate |
| `86c9zfj2g` | polish chip label clarity | to do | — | sponsor wording-gate |
| Obs 13 IMPL | not filed yet | — | — | sponsor priority signal needed |

**Worktrees (all clean):**
- `c:/Trunk/PRIVATE/ClaudeTeam` — orch, main `93402bf`, modified coord-state files staged (deferred-commit pattern)
- `c:/Trunk/PRIVATE/ClaudeTeam-felix-wt` — detached, idle
- `c:/Trunk/PRIVATE/ClaudeTeam-maya-wt` — detached, idle
- `c:/Trunk/PRIVATE/ClaudeTeam-bram-wt` — detached, idle
- `c:/Trunk/PRIVATE/ClaudeTeam-{iris,nora,sage}-wt` — idle since prior milestones

**Decisions-while-away.md backlog:** 14+ pending review (carried) + ~8 new auto-decisions this away session (deferred batch-log; ALL fit rule 6.6 #1 routine-merge / Bram-research orch-direct / NITs-creation classes; 0% reversal observed across all ticks).

**Auto-status cron:** `591c12fe` armed; mode=away; interval=15m; last_tick 2026-05-26T21:40:06Z.

## Prior current-state — 2026-05-26 21:03 UTC (away-tick #3 — Obs 8/9/10/11/13 + perf-dedup wave in flight)

**Resume next-action:** Main at `72264e7` (PR #87 squash-merge). Sponsor is `/auto-status away` — cron job `591c12fe` fires at :07/:22/:37/:52 each hour. 2 in flight: Maya reviewing PR #86 (Felix perf-dedup, ticket `86c9zfmke`, CI green post-fix); Felix reviewing PR #88 (Maya Obs 11 humanize elapsed-time, ticket `86c9zfmhp`, CI 1 green + 1 in-progress). Bram idle (no scope).

**Sponsor sign-off queue (write here per rule 6.4):**
1. **PR #88 wording-choice (Obs 11):** Maya's PR body lists 3 candidates — **A** `finished 5h` (compact, recommended), **B** `finished 5h ago` (+4 chars), **C** static `finished` + tooltip-only (regresses Obs 6). Felix's review covers CODE/ARCHITECTURE only; wording is sponsor-side. Both B and C are <30-line follow-up patches if A is rejected. Merge gate.
2. **Polish ticket `86c9zfj2g`** (chip label clarity rename, e.g. `(N rostered)` → `(N active)` or similar) — sponsor names the wording before dispatch.
3. **Obs 13 IMPL dispatch** (ticket carried over; Bram triage shipped at PR #85; impl is Felix scope — option (b) `stop_reason=end_turn` in sub-agent JSONL → `SubagentActivity.isFinished` → reducer.ts `inferState` returns `"finished"`). Awaiting sponsor priority signal before kicking off (substantial scope: subagentTailer + reducer + types changes + integration tests + no-regression).

**Shipped this away session (2026-05-26 ~16:00–21:03 UTC):**

| PR | Subject | Merge SHA | Ticket | Status |
|---|---|---|---|---|
| #81 | Bram Obs 9 init-phase triage | `ebdc68d` | `86c9zbuqq` | merged |
| #82 | Felix Obs 9 misclassification fix | `6150e9f` | `86c9zc5dd` | merged |
| #83 | Bram (1 rostered) chip-label triage | `f58a6f5` | `86c9zfbpg` | merged |
| #84 | Maya Obs 8 chip state-aware | `198fc75` | `86c9zfmgg` | merged + NITs ticket `86c9zfrzt` filed |
| #85 | Bram Obs 13 background-finished triage | `c7f0e1f` | `86c9zfj83` | merged |
| #87 | Maya Obs 10 expansion preservation | `72264e7` | `86c9zfmh1` | merged |

**In-flight tickets (this away session):**

| Ticket | Subject | Status | PR | Owner | Reviewer |
|---|---|---|---|---|---|
| `86c9zfmke` | perf JSONL dedup | in review | #86 | Felix (✓ author + CI-fix) | Maya (in flight) |
| `86c9zfmhp` | Obs 11 humanize elapsed-time | in review | #88 | Maya (✓ author) | Felix (in flight; code-only); sponsor wording-gate |
| `86c9zfj2g` | polish chip label clarity | to do | — | Maya (queued) | sponsor wording-gate |
| `86c9zfrzt` | Obs 8 NITs follow-up | to do | — | Felix/Iris (XS) | cross-pair |
| Obs 13 IMPL | new ticket needed | not filed | — | Felix (post-PR-#86) | Maya + Sage |

**Worktrees:**
- `c:/Trunk/PRIVATE/ClaudeTeam` — orch, main `72264e7`, modified coord-state files staged (deferred-commit pattern)
- `c:/Trunk/PRIVATE/ClaudeTeam-felix-wt` — on PR #88 branch (Maya's, for review)
- `c:/Trunk/PRIVATE/ClaudeTeam-maya-wt` — on PR #86 branch (Felix's, for review)
- `c:/Trunk/PRIVATE/ClaudeTeam-bram-wt` — detached, idle
- `c:/Trunk/PRIVATE/ClaudeTeam-{iris,nora,sage}-wt` — idle since prior milestones

**Decisions-while-away.md backlog:** 14+ pending review (carried) + 4-5 new auto-decisions this away session (deferred batch-log; pattern is rule 6.6 #1 routine merges with peer-reviewer APPROVE / orch-direct Bram-research). 0% reversal observed across all ticks.

**Auto-status cron:** `591c12fe` armed; last_tick 2026-05-26T21:03:19Z; mode=away; interval=15m.

## Prior current-state — 2026-05-26 (Obs 3 forceRefresh fix shipped; PR #75/#76/#77 sponsor-override merged during Actions incident; sponsor next: rebuild + retest)

**Resume next-action:** Main at `207b9ca` (PR #77 squash-merge). 3-PR merge wave just landed (PR #75 Bram round-2 triage research / PR #76 Maya hydrateState M5 fields / PR #77 Felix forceRefresh Obs 3 fix). All 3 merged under sponsor-explicit override of hard rule #2 (green CI) due to GitHub Actions incident (started ~10:57Z, latest run 09:26Z, ~3h stale at merge time). Peer-review APPROVE clean on all three; local test verification independently reproduced by reviewers. Sponsor's next gate: `git pull && npm run build && npx vsce package --no-yarn && code --install-extension claudeteam-0.0.1.vsix --force` → reload window → close+reopen pane test → session tile should re-appear ≤2s (vs prior >30s persistent empty-state). If forceRefresh works as designed: Obs 3 verified, can resume Obs 6a/6b verification. If still failing: deeper triage needed.

Tickets all complete: `86c9z5a3k`, `86c9z5j3r`, `86c9z5hyp`. Open follow-ups: `86c9z4p86` (PR #74 NITs, P4) + sponsor-pending decisions calibration from prior session (11+ entries marked `pending review`).

No agents in flight; no open PRs. Worktrees all detached (Bram/Felix/Maya).

## Older state — 2026-05-26 (Obs 3 fix shipped; sponsor next: rebuild + retest)

**Resume next-action:** PR #73 admin-squash-merged at `daf6109` (Felix APPROVE, CI both green, auto-decide per rule 6.6 routine-merge class). Tickets `86c9z0w56` + `86c9z171k` both complete. No agents in flight; no open PRs. Sponsor's next gate: `git pull && npm run build && npx vsce package --no-yarn && code --install-extension claudeteam-0.0.1.vsix --force` + reload window + close+reopen pane test → session tile should re-appear ≤2s (vs prior >30s). If pass: continue Obs 6a/6b/hide-finished-toggle verification. If still >30s: file follow-up on the secondary anomaly Bram flagged.

Pending: maintain-docs-hook-trim ticket — sponsor flagged main-thread bloat from SKILL.md being dumped on every Stop-hook fire; orch proposed 3 fixes (hook-side early-exit / SKILL.md trim / background-agent invocation). Ticket not yet filed.

## Prior current-state — 2026-05-26 (Obs 3 fix in peer-review; Felix on PR #73)

**Resume next-action:** Felix dispatched 2026-05-26T09:08Z on peer-review of Maya's PR #73 (ticket `86c9z171k`, branch `maya/86c9z171k-obs3-boot-refresh` @ `4b46f6c`, Felix agent name `felix-pr73-review`). Expected-by ~10-20 min (XS one-liner + 2 tests to verify). On Felix verdict: APPROVE + CI green → auto-decide admin-squash-merge per rule 6.6 routine-merge class → sponsor rebuilds + reinstalls vsix + re-tests Obs 3 close+reopen.

Maya's PR #73 contains: one-line `api.postMessage({ type: "ui:refresh" })` at end of `src/webview/main.ts:boot()` after `initMessageReceiver({...})` returns; new `tests/unit/webview/bootRefresh.test.ts` with 2 jsdom tests. Local: 456 passed + 2 skipped; typecheck + lint + build clean; bundle ships the dispatch at `dist/webview/main.js:1082`. CI catch-up pending. AC2 (close+reopen timing) and AC6 (Self-Test) defer to sponsor per sub-agent GUI-gap.

Bram's Obs 3 triage (ticket `86c9z0w56`) complete — PR #72 merged at `72626b1`. Verdict: hypothesis (b) — VS Code does NOT buffer `webview.postMessage`. Bram flagged secondary unverified ">30s duration anomaly" — sponsor's close+reopen retest after Maya merges will confirm/refute.

Main at `72626b1` (PR #72 squash-merge). Sponsor's installed vsix is still from `0a6945d` (two SHAs stale; rebuild after PR #73 merges). Auto-status local-mode cron `81105166` armed (5-min read-only pulse).

Cumulative V1 + dogfood-arc auto-decide track record: 31 + ~11 = ~42 merges, 0 reversals (sponsor has not yet completed `pending review` calibration). Main at `0a6945d` (PR #70 squash-merge — M5-WV hide-finished webview, merged 2026-05-26T07:51Z).

**Staged orch-coord files** (from prior session's stash-pop, deferred batch-commit per project convention): `.claude/away-queue.md`, `.claude/decisions-while-away.md`, `.claude/docs/orchestration-overview.md`, `team/STATE.md`. Plus 10 untracked Maya/Felix scratch review files (pre-existing).

## Prior current-state — 2026-05-25 (V1 SHIPPED — all 4 milestones + 31 PRs merged; only post-V1 follow-ups remain)

**Resume next-action:** V1 closed at 2026-05-25T09:12Z with PR #60 merge → main `4d9ad4d` (Nora M4-06 retro + V1 cross-arc retrospective). Cumulative V1 auto-decide track record: **31 merges, 0 reversals** (per Nora's retro). Test totals at V1 ship: 477 passing (386 unit + 68 integration + 23 Layer-3). 6 global orchestrator-discipline rules active. Marketplace publication explicitly deferred post-V1 (its own milestone).

**Post-V1 follow-ups (to do, not blocking):**
- `86c9yjy4w` — chore(perf): in-extension-host heap snapshot probe — M4-04 follow-up (P3 NIT-class; created post-V1 per retro Next-session-backlog).
- Marketplace publication milestone — separate scope, opens when sponsor decides V1 dogfooding informs publish readiness.
- maintain-docs candidates Nora flagged (4): scripts/ triple-edit pattern, tsx-vs-production heap caveat, 100% hash-skip steady-state, Iris-leads-decomposes-parallel-zones pattern. Sponsor may dispatch maintain-docs or absorb during next session.

**Auto-status cron `c2952acd` still armed (15-min tick at :07/:22/:37/:52).** Sponsor may `/auto-status off` if entering quiet period.

## Prior current-state (M4 Wave 2 — Nora M4-06 V1-close retro in flight; all M4 impl shipped)

**Resume next-action:** If this session dies right now, next orchestrator should: (a) check **Nora's agent `af66e3756e080c427`** (M4-06 V1-close retro + cross-V1-arc retrospective, branch `nora/86c9ygcmj-m4-close-retro`) via `TaskOutput` — dispatched 2026-05-25T08:55Z, expected-by ~2026-05-25T09:25Z (M-sized: dual-retro deliverable + V1 ship-list + V2 candidate-list); (b) on PR open, orchestrator-direct review (Nora-domain per project convention; same pattern as M1/M2/M3 close); (c) admin-squash-merge → **V1 CLOSES**; (d) post-V1: file follow-up tickets per Nora's Next-session-backlog (M4-04 extension-host heap probe NIT, marketplace publication milestone kickoff). Auto-status cron `c2952acd` still armed.

**M4 milestone progress at this point:**
- M4-01 spec ✓ `86c9ygcgv` complete (PR #54)
- M4-02 styling tokens ✓ `86c9ygcj4` complete (PR #56)
- M4-03 drill-in ✓ `86c9ygcjg` complete (PR #57)
- M4-04 cadence ✓ `86c9ygck9` complete (PR #59)
- M4-05 status visuals ✓ `86c9ygckv` complete (PR #58)
- never-fab propagation ✓ `86c9yhwdf` complete (PR #55)
- M4-06 retro — `86c9ygcmj` in flight (Nora)

**Main tip:** `d9b1b49` (PR #59 M4-04 squash-merge).

## Prior current-state (Wave 1c+ — Felix M4-04 WIP recovery; ClickUp synced)

**Resume next-action:** If this session dies right now, next orchestrator should: (a) check **Felix's agent `ad5ec70284aa01681`** (M4-04 WIP recovery; prior dispatch `a002576486ec78470` ended with orphaned background-bash, no PR opened, uncommitted scaffolding in `felix-wt`). Recovery brief: pick up existing branch, run measurements in FOREGROUND bash with explicit `timeout` (no background to prevent orphan), write measurement doc, commit + PR. Expected-by ~2026-05-25T09:00Z (M-sized + sequenced foreground probes). (b) On PR open, Maya peer-review → APPROVE → admin-squash-merge per rule 6.1. (c) After M4-04 merges → Wave 2: dispatch **Nora M4-06** (`86c9ygcmj`, V1 close cross-arc retrospective). This closes V1. (d) ClickUp board now SYNCED: never-fab ticket `86c9yhwdf` created + complete; M4-02/03/05 + never-fab all `complete`; M4-04 `in progress` (Felix WIP). ClickUp MCP loaded mid-session at ~08:20Z; `MCP_TIMEOUT=120000ms` set in user-global settings (takes effect next CC session restart). Auto-status AWAY cron `7,22,37,52 * * * *` (job `c2952acd`) armed.

**M4 board progress:**
- M4-01 spec ✓ `86c9ygcgv` complete (PR #54)
- M4-02 styling tokens ✓ `86c9ygcj4` complete (PR #56)
- M4-03 drill-in ✓ `86c9ygcjg` complete (PR #57)
- M4-05 status visuals ✓ `86c9ygckv` complete (PR #58)
- never-fab propagation ✓ `86c9yhwdf` complete (PR #55, ticket backfilled)
- M4-04 cadence — `86c9ygck9` IN PROGRESS (Felix WIP recovery `ad5ec70284aa01681`)
- M4-06 retro — `86c9ygcmj` to do (Wave 2, after M4-04 merges)

**M4 progress at this point:**
- M4-01 spec ✓ (PR #54, `2913479`)
- M4-02 styling tokens ✓ (PR #56, `80d02bf`)
- M4-03 drill-in affordance ✓ (PR #57, `b61c02c`)
- M4-05 status-state visuals ✓ (PR #58, `55e4140`)
- never-fab propagation ✓ (PR #55, `501dadc`)
- M4-04 cadence — IN FLIGHT (Felix)
- M4-06 retro — Wave 2 (after M4-04)

**Sponsor's M4 scope decisions (settled via AskUserQuestion 2026-05-25T06:25Z):**
- All four V1-PLAN M4 areas: styling, drill-in, status states, refresh-cadence tuning.
- Marketplace publication DEFERRED post-V1.
- Iris LEADS — design specs before any dev dispatch (for styling + status-states; M4-03 drill-in + M4-04 cadence don't need Iris).
- `86c9yfj6n` dispatch-template detach codification ships alongside M4 (in flight now).

- **`origin/main` tip:** `2913479` (PR #54 squash-merge — Iris M4-01 design spec). Verify: `git rev-parse origin/main`.
- **M3 fully shipped** — Wave 0 + Wave 1 + retro (PR #49) + all in-scope NITs (PR #50) + retro test-count fix (PR #51). Tests on main: **353 passing unit (+3 known skips, 356 total) + 68 integration + 23 Layer-3 = 444 passing** (M3 net delta +166 passing per Nora's verified count).
- **6 global orchestrator-discipline rules now active in `~/.claude/CLAUDE.md`** (was 5; +1 added this round): wake-signal, background-agent staleness verification, **sub-agent worktree-concurrency** (NEW), cross-session continuity, main-thread bloat, parallel-agent shared-concept vocabulary. Audit trail at [team/log/applied/](team/log/applied/).
- **In-flight agents:**
  - **Maya `a652b2323cf92068e`** — M4-02 styling tokens + theme-mapping refactor (ticket `86c9ygcj4`). M-sized CSS-only. Dispatched 2026-05-25T07:24Z, expected-by ~2026-05-25T07:50Z. Worktree `c:\Trunk\PRIVATE\ClaudeTeam-maya-wt` on branch `maya/86c9ygcj4-m4-02-styling-tokens`. Reviewer: Felix. Per staleness-verification rule: on cron tick / "Status" trigger, run `TaskOutput a652b2323cf92068e` + `git -C C:/Trunk/PRIVATE/ClaudeTeam-maya-wt log --oneline -5 origin/maya/86c9ygcj4-m4-02-styling-tokens` + `gh pr list --author "@me" --state open` BEFORE reporting.
  - **Felix `a075d290231e0ca66`** — `chore(orch): propagate "Never fabricate" rule to sub-agents via project CLAUDE.md + dispatch-template`. XS docs-only. Felix creates the ClickUp ticket at start of work (no ticket yet — list `901523520912`). Dispatched 2026-05-25T07:25Z, expected-by ~2026-05-25T07:45Z. Worktree `c:\Trunk\PRIVATE\ClaudeTeam-felix-wt` on branch `felix/never-fabricate-propagation`. Reviewer: Maya. Per staleness-verification rule: same ritual but `TaskOutput a075d290231e0ca66`.
- **Queued (worktree-concurrency-bound — sequence within persona):**
  - Maya: after M4-02 merges → dispatch M4-05 (`86c9ygckv`, status-state visuals per spec § 2). Felix-reviewer.
  - Felix: after never-fab merges → dispatch M4-03 (`86c9ygcjg`, drill-in affordance). Maya-reviewer.
  - Felix: after M4-03 merges → dispatch M4-04 (`86c9ygck9`, refresh-cadence tuning). Maya-reviewer. EXTENSION-MANIFEST gate.
  - After M4-01..M4-05 all merged → Wave 2: Nora M4-06 retro (`86c9ygcmj`).
- **Open PRs:** none.
- **ClickUp board state:** ALL M3 + carryover tickets at `complete`:
  - `86c9yee3g` (PR #47 NITs) → complete (PR #50 merged).
  - `86c9y7y9z` (M2-04 NITs) → complete as **phantom** (M2-06 PR #28 absorbed both NITs; comment posted with file:line evidence).
  - `86c9yfj5e` (PR #49 retro typo) → complete (PR #51 merged).
- **Sponsor-pending now:** **M4 opening** — scope/sequence/tickets, plus optional dispatch authorization for `86c9yfj6n`.
- **Completed this session (newest first, abbreviated for older items):**
  - Auto-merge PR #51 — Nora retro test-count fix → main tip `37d2c98`. Decision-log entry `2026-05-25 0543 UTC`.
  - Phantom-close `86c9y7y9z` — Felix evidence (NIT #1 + #2 already on main since PR #28 `b8ada36`). Decision-log entry `2026-05-25 0540 UTC`.
  - Persisted **Sub-agent worktree-concurrency discipline** rule to `~/.claude/CLAUDE.md` (sponsor-direct). Decision-log entry `2026-05-25 0535 UTC`. Audit at `team/log/applied/applied-rule-worktree-concurrency-2026-05-25.md`.
  - Worktree-collision **near-miss recovery** (TaskStop'd duplicate Felix dispatch before Step 0). Triggered the new rule above.
  - Felix `ae0cfdc95d506d8af` — peer-review PR #51 → APPROVE (took 1.5 min).
  - Felix `a8cccc4405f9c1b84` — M2-04 NITs investigation → **NO-OP phantom** (both NITs already on main).
  - Nora `a0c2ffc8d18ab1000` — PR #49 retro typo fix → PR #51 opened (took 1.1 min).
  - ClickUp MCP reconnected mid-session, enabling: flip 86c9yee3g, create 86c9yfj5e + 86c9yfj6n, phantom-close 86c9y7y9z, flip 86c9yfj5e through workflow → complete.
  - Auto-merges PR #49 + PR #50 (Nora retro + Maya PR #47 NITs) — decision-log entries `0030 UTC` + `0045 UTC`. Peer-reviews Felix `ab48057bad3b13bf9` + `a8ea637ff05d77632` + `a8ea637ff05d77632` (retro APPROVE_WITH_NITS, PR #50 APPROVE). Authoring dispatches Nora `a404fd831f7036701` (retro) + Maya `a596cce4ec0eb3fdc` (PR #47 NITs).
- **NIT outstanding:** `86c9yee3g` (queued for Maya post-retro); `86c9y7y9z` (M2-04 NITs, sponsor-held — do NOT auto-close).
- **Auto-status:** sponsor invoked `/auto-status away` this turn — state file should reflect `enabled=true, mode=away` after skill execution.
- **Working tree (main):** clean of code. 5 untracked Maya scratch files at `team/maya-dev/pr-*-review*.md` — NOT coord state, leave or sponsor moves to `.scratch/` later.

**ClickUp board state:**
- **Complete:** all M3-01 through M3-10 main tickets + Wave 0 NIT follow-ups + `86c9ydz4k` (formatFreshness NIT, absorbed into PR #47).
- **To do (active):** `86c9yee3g` (Maya, queued post-retro).
- **To do (sponsor-held):** `86c9y7y9z` (M2-04 NITs, do NOT auto-close).

**M2 fully closed (unchanged):** all 12 PRs merged + P0 CJS shim + retro PR #31. Production .vsix activates on Node 22+.

**M1 status: SHIPPED 2026-05-23.** 11/11 tickets + M1-09-followup. Retro at [.claude/retros/retro-2026-05-23-m1-close.md](.claude/retros/retro-2026-05-23-m1-close.md).

---

## Worktree state — 2026-05-23

| Worktree | At commit | Branch state | Notes |
|---|---|---|---|
| `c:\Trunk\PRIVATE\ClaudeTeam` | `57c78a7` | `main` | Orchestrator survey — READ-ONLY for code |
| `c:\Trunk\PRIVATE\ClaudeTeam-bram-wt` | `7f79ba6` | detached | Was on `bram/m1-11-data-sources-update` |
| `c:\Trunk\PRIVATE\ClaudeTeam-felix-wt` | `b19c5bf` | detached | Was on `felix/m1-07-sessions-registry` |
| `c:\Trunk\PRIVATE\ClaudeTeam-iris-wt` | `53f5269` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-maya-wt` | `b19c5bf` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-nora-wt` | `ed64350` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-sage-wt` | `8fc667c` | detached | — |

Felix's dispatch on M1-09 will start with `git -C <felix-wt> fetch origin && git checkout -B felix/m1-09-cli-driver origin/main` — standard Step 0.

---

## ClickUp ticket map (M1) — 2026-05-23

| Ticket | ClickUp ID | Status | Owner | Reviewer |
|---|---|---|---|---|
| M1-01 | `86c9y5c4g` | complete | Felix | Maya |
| M1-02 | `86c9y5c7v` | complete | Bram | orch |
| M1-03 | `86c9y5c8m` | complete | Iris | Felix |
| M1-04 | `86c9y5ca3` | complete | Sage | Felix |
| M1-05 | `86c9y5cah` | complete | Felix | Maya |
| M1-06 | `86c9y5ccb` | complete | Felix | Maya |
| M1-07 | `86c9y5ccn` | complete | Felix | Maya |
| M1-08 | `86c9y5cfe` | complete | Felix | Maya |
| **M1-09** | `86c9y5chc` | **to do** | Felix | Maya |
| **M1-10** | `86c9y5cmg` | **to do** | Sage | Felix |
| M1-11 | `86c9y5q8d` | complete | Bram | orch |

---

## Per-role sections (append-only history below)

### Nora (Project Lead)

- Last updated: 2026-05-25 (M4 backlog authored)
- Status: in review (M4 backlog PR open)
- Working on: nothing in flight after PR open
- Blocked on: nothing — M4-01 Iris dispatch is the next likely orch action (per sponsor's "Iris first, then parallel dev wave" sequencing)

**Run log of substantive coordination-doc PRs (newest at top):**

#### 2026-05-25 — M4 backlog authored

- Backlog: `team/nora-pl/milestone-4-backlog.md` (6 tickets — M4-01 Iris spec / M4-02 Maya tokens / M4-03 Felix+Maya drill-in polish / M4-04 Felix cadence / M4-05 Maya status states / M4-06 Nora M4+V1-close retro)
- All six get ClickUp tickets (zero orch-direct chore class this milestone per sponsor scope)
- Wave plan: Iris solo Wave 0 → 4-agent (or 3-if-Maya-sequenced) Wave 1 → Nora retro Wave 2
- Out-of-M4 follow-ups documented at top: 4 outstanding NITs/sponsor-held tickets reassessed at M4-06, plus dispatch-template vocab block + STATE.md schema rollout + decisions-log batch from M3 retro
- Marketplace publication confirmed DEFERRED post-V1 per sponsor 2026-05-25; gets its own milestone
- Branch: `nora/m4-backlog`

#### 2026-05-24 — M2-close retro authored

- Retro: `.claude/retros/retro-2026-05-24-m2-close.md` (~3100 words; comparable to M1 retro depth, slightly longer to cover 12 merged PRs + 10 auto-decisions)
- Surfaced 10/10 auto-decide / 0-reversal calibration finding → recommendation to promote more rule 6.6 classes (NITs-ticket-creation, log-only-conflict recovery, NITs-absorption-into-downstream)
- Surfaced chain-of-deferred-validations anti-pattern (M2-01 placeholder-screenshot deferral → M2-06 sub-agent-GUI deferral → CJS shim bug only caught at M2-08 Layer-3 in PR #29)
- 8 next-session backlog items filed (M3 scope confirm, auto-decide promotion draft, ENTRY-NNN collision prevention, cross-project port of GUI-gap + permission-rule, test-plan executor mapping discipline, install-path validation at first-shipping PR, main-thread merge-narration tightening, M3 Layer-3 expansion)
- Branch: `nora/m2-close-retro`

#### 2026-05-23 — M1 backlog created

- Project plan: `team/nora-pl/project-plan.md`
- M1 backlog: `team/nora-pl/milestone-1-backlog.md` (10 tickets, dispatch-ready)
- Risk register: `team/nora-pl/risk-register.md` (5 entries, all `held`)
- ClickUp tickets created in list `901523520912` (IDs appended once created)
- Open questions surfaced for sponsor: (1) CLI output ownership; (2) fixture sourcing / anonymization scope
- Branch: `nora/v1-planning-kickoff`
- Recommended first wave: M1-01 (Felix), M1-02 (Bram), M1-03 (Iris) — all zero-dep, fired in parallel.

### Iris (UX Designer)

- Last updated: 2026-05-23 (M1-03 merged in PR #3, commit `7487ccb`)
- Status: idle (M1-03 CLI output spec shipped; M2/M3 design work blocked on M1-09)
- Working on: nothing in flight
- Blocked on: nothing — M2 dashboard tile spec is the next likely dispatch

### Felix (Senior Dev — extension host)

- Last updated: 2026-05-23 (M1-07 merged in PR #13, commit `dbab662`)
- Status: idle pre-M1-09; **next dispatch target**
- Working on: nothing in flight; M1-09 is the next dispatch
- Blocked on: nothing — all M1-09 dependencies (M1-05/06/07/08) merged

### Maya (Senior Dev — webview)

- Last updated: 2026-05-23 (most recent activity: peer-reviewing PR #12 + PR #13)
- Status: idle; reviewer for M1-09 when Felix opens that PR
- Working on: nothing in flight
- Blocked on: nothing — M1-09 review when PR opens; no M1 primary work for Maya

### Sage (QA / Tester)

- Last updated: 2026-05-23 (M1-04 merged in PR #7, commit `8d5246a`)
- Status: idle pre-M1-10
- Working on: nothing in flight
- Blocked on: M1-09 merge — M1-10 integration tests depend on M1-09's reducer being available

### Bram (Research / Internals)

- Last updated: 2026-05-23 (M1-11 merged in PR #9, commit `81bef17`)
- Status: idle
- Working on: nothing in flight
- Blocked on: nothing — no pending research asks for M1; M2 research may surface VS Code Extension API prior-art needs
