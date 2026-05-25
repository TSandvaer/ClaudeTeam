# Retro — M4 close + V1 close cross-arc retrospective

**Date:** 2026-05-25
**Scope:** M4 close — backlog tickets M4-01 through M4-05 (5 impl tickets) + 1 milestone-period chore (`501dadc` never-fabricate rule propagation) + M4-06 (this retro). 7 PRs merged this milestone (PR #53–#59), all in a single session arc following the M3 close. Cross-arc retrospective covers M1 → M2 → M3 → M4 (V1 close).
**Author:** Nora

---

## Outcome

M4 shipped. The extension now (1) consumes a named `--ct-*` token system covering 20 tokens against VS Code theme variables (M4-02), (2) telegraphs running / idle / finished / error states via Iris-designed visuals with a 12-cell transition matrix + reduced-motion fallback (M4-05), (3) makes drill-in feel like an affordance — `cursor: pointer`, "Open agent transcript" tooltip, whole-tile click target, keyboard Enter/Space, focus-visible outline, and `{ preview: true }` so the editor area doesn't choke with JSONL tabs (M4-03), (4) ticks at an empirically-validated 2-second cadence with a measurement methodology doc + memory probe captured for repeatability (M4-04). Iris's M4-01 design spec was authored, peer-reviewed, and consumed verbatim by Maya in M4-02/M4-05 + Felix in M4-03 — the Iris-leads sequencing pattern paid out a third time (after M1-03 + M2-03).

**V1 closes here.** The roster-matcher thesis from M1 → extension scaffold from M2 → roster config + live refresh from M3 → polish from M4 all shipped without revert. Marketplace publication is explicitly deferred to its own post-V1 milestone.

**Test totals at `origin/main` tip `d9b1b49`:** **386 passing unit (+2 known skips) + 68 integration + 23 Layer-3 = 477 passing**. M4 added 33 net passing tests over M3 close (444 → 477).

| PR | Author / scope | Merged at | Reviewer verdict |
|---|---|---|---|
| #52 | Felix — `86c9yfj6n` dispatch-template detach codification (M3-tail carry-over) | `3cd8c2a` | Maya APPROVE (pre-M4 prelude, listed in M3-close-tail but landed during M4 window) |
| #53 | Nora — M4 backlog | `06d53f2` | orch-direct |
| #54 | Iris — M4-01 polish spec (tokens + state visuals + drill-in) | `2913479` | Maya APPROVE |
| #55 | Felix — `chore(orch)` never-fabricate rule propagation (project CLAUDE.md + dispatch-template) | `501dadc` | Maya APPROVE |
| #56 | Maya — M4-02 styling tokens + theme-mapping refactor | `80d02bf` | Felix APPROVE |
| #57 | Felix — M4-03 drill-in affordance polish (tooltip + preview-flag + AC verifications) | `b61c02c` | Maya APPROVE |
| #58 | Maya — M4-05 status-state visuals + transition matrix | `55e4140` | Felix APPROVE |
| #59 | Felix — M4-04 cadence tuning + memory probe | `d9b1b49` | Maya APPROVE |

Plus orch-doc commit `12b0f86` interleaved (M3 close + M4 open coord-doc updates). No reverts. No broken-main events. No vocabulary-divergence incidents (M3 lesson held). No same-tick log-only conflicts in the M4 impl wave (the `clickup-pending.md` ENTRY scheme switch from M3-05 paid out — every M4 PR appended a timestamp-keyed entry without collision).

## What went well

- **Iris-leads-with-spec sequencing produced two clean implementations from a single design pass.** Iris's M4-01 §1 (Styling tokens) + §2 (Status-state visuals + transition matrix) + §3 (Drill-in affordance model) was lifted verbatim into M4-02, M4-05, and M4-03 dispatch briefs. Zero clarification round-trips during dispatch. Maya's PR #56 + #58 cite specific Iris §-numbers throughout; Felix's PR #57 cites M4-01 §3.3 for tooltip wording and §3.6 for the `{ preview: true }` decision. This is the same Iris-leads pattern that drove M1-03 → M1-09 (CLI output vocabulary), M2-03 → M2-05/06 (dashboard tile spec → renderer + integration), and now M4-01 → M4-02/03/05. Three milestones validating the pattern. The shape is durable: when a milestone has a visual/UX axis, dispatching Iris first as a solo gate produces dev-ready briefs that ship without back-and-forth.

- **Vocabulary contract discipline (M3 lesson) prevented a recurrence on M4-05's `prevState` tracker.** Maya's M4-05 PR body has an explicit "Vocabulary contract (matches M4-01 §5.4)" subsection naming the 5 identifiers — `data-transition` attribute values, `ct-pulse` + `ct-error-flash` keyframe names, `--ct-color-state-*` CSS custom properties, `prevState?: AgentState` prop on `AgentTileProps`, `PrevStateTracker` interface + `createPrevStateTracker()` factory in new file `src/webview/prevStateTracker.ts`. Iris pre-authored the vocabulary in M4-01 §5.4 specifically so M4-05 + M4-03 (which both touch `agentTile.ts` in parallel) shared the names from spec time. Felix's M4-03 PR #57 explicitly cross-references M4-05's expected `agentTile.ts` surface in a "Conflict-awareness — M4-05 (Maya parallel)" table — each PR owned non-overlapping line ranges. Both PRs landed within 30 minutes of each other without a rebase conflict. The new parallel-agent-vocabulary-discipline rule's Pattern B (vocabulary contract in the spec) worked exactly as designed.

- **Felix's anti-fabrication framing on M4-04 set the bar for measurement-class deliverables.** Felix reported "+4.6 MB / 10 min in tsx harness" and explicitly did NOT claim "no leak detected" — the documented verdict is *"Plausibly clean — follow-up needed"*. Three named confounds (harness `hashes[]` array growth ≈ 600 KB, tsx source-map retention, no dispose boundary across iters) — not glossed. Follow-up VS Code extension-host probe recommended in four places (doc § Memory posture, doc § Recommendation summary, PR body table, Self-Test Report § Out of scope). This is the never-fabricate rule (PR #55, landed earlier in the same session) being applied to a deliverable that COULD have shipped a confident "no leak" claim — but didn't, because the harness environment isn't the production environment. Maya's peer-review explicitly called out the framing: *"the PR body recommendation summary lifts the memory posture from a fragile 'no leak' claim to a defensible 'plausibly clean — extension-host probe is the definitive next step.'"* This is the standard future measurement-class tickets should be held to.

- **Auto-decide track record continues: 7/7 auto-merges across M4, 0 reversals.** Every code + spec + chore PR merged via the promoted auto-decide classes from M2/M3 calibration. Sponsor reversed none on review. Cumulative track record across M1+M2+M3+M4: **31 auto-merges, 0 reversals**. The 0% reversal rate now spans four milestones — the autonomy framework is well-calibrated and the promoted classes (routine PR-merge with CI green + peer-reviewer APPROVE; orch-docs class with peer reviewer attached; NITs-ticket-creation from APPROVE_WITH_NITS; log-only-conflict `--ours` recovery; NITs-absorption-into-downstream; cross-persona review routing) all continue to fire without sponsor revision.

- **Never-fabricate rule propagation (PR #55) shipped same session it was authored — self-referential demonstration.** Felix's PR #55 propagates the user-global "Never fabricate, never guess, never extrapolate" rule into project CLAUDE.md (rule 10) + `.claude/agents/dispatch-template.md` § Anti-fabrication contract. The PR body itself follows the rule — every concrete value (file:line refs, line counts, commit SHA, typecheck result) is sourced from a verifiable command quoted in the body's "self-referential proof" subsection. This is the pattern future discipline-codifying PRs should adopt: prove the rule works by following it in the PR that introduces it. The rule also paid out the same session via Felix's M4-04 anti-fabrication framing on the memory probe (see "What went well" #3).

- **Cross-review pairing held 7/7 PRs, zero self-merges.** Felix ↔ Maya for every code PR; Iris's design PR reviewed by Maya (visual primary); Nora's backlog + retro PRs orch-direct. Cross-pair discipline scaled cleanly across the Wave 0 + Wave 1 + Wave 2 sequence. The "Felix reviews Maya's webview PRs, Maya reviews Felix's host PRs" rule from M2 retro is now habitual across four milestones.

- **`{ preview: true }` decision shipped with explicit reversibility framing.** Felix's M4-03 PR #57 ships `vscode.window.showTextDocument(uri, { preview: true })` based on M4-01 §3.6's recommendation. The PR body explicitly documents the call as "one-line revert if dogfooding finds preview replacement annoying" + flags M4-06 retro as the verdict point. This is the right shape for a non-mechanical user-facing call: ship the spec recommendation, mark the reversibility, capture the verdict at retro. Sponsor dogfooding informs whether to revert — the dispatch didn't try to pre-decide the polish question that only emerges from real usage.

- **STATE.md "Resume next-action" header discipline held across the M4 wave.** Visible across orch commits in the M4 window (`12b0f86` and prior). The header was updated at every dispatch / merge boundary per the cross-session continuity rule (codified at M3 close). No session-boundary in M4 forced a recovery probe — but the discipline IS what would have made any recovery cheap.

## What went poorly

- **The "scripts/ triple-edit" pattern surfaced late in M4-04.** Felix's first packaging attempt on PR #59 included `scripts/measure-cadence.ts` in the VSIX because `.vscodeignore` didn't exclude `scripts/`. Caught by `vsce package --no-yarn` review; Felix added `scripts/` to `.vscodeignore` + `scripts/**/*.ts` to `tsconfig.json` `include` (so `npm run typecheck` saw the harness). Three files touched (`tsconfig.json` + `.vscodeignore` + the new script) where one might have expected two. This is a structural gap in `.claude/docs/vscode-extension-conventions.md` — the project doc doesn't yet codify the "any new top-level dev-only TS directory needs three edits" pattern. Cost: ~one rebuild cycle. Felix flagged the pattern in his PR body as a non-obvious finding worth capturing. Promoted to durable lessons (see below).

- **Sub-agent `run_in_background` bash orphan on M4-04's first attempt.** Felix's first M4-04 dispatch orphaned a 10-min memory probe + wait-wrapper when his agent terminated mid-bash. Recovery via WIP-resume + foreground-bash-with-`timeout` mandate (now codified in `.claude/docs/orchestration-overview.md`). The root cause is structural: when a sub-agent runs a background bash task (`run_in_background: true`) that outlives the agent's reasoning loop, the bash process keeps running but the agent has no way to harvest the output before its session ends. The recovery pattern (foreground `timeout 600 npm run ...` so the agent stays alive for the duration) is the right fix; the M4-04 PR #59 successfully ran the 10-min probe in a single foreground tool call after the recovery dispatch. Cost: ~one dispatch cycle of latency. Worth a retro anti-pattern entry — this is distinct from the M3 wake-signal rule (which covers orch-side waits) and the orchestration-overview.md entry (which we cite as the prevention). The orphan was sub-agent-side, not orch-side.

- **ClickUp MCP delayed-load + accumulated backlog at session start.** Orchestrator-side MCP didn't connect until ~08:20Z this session; ticket flush + never-fab ticket creation deferred via `team/log/clickup-pending.md` NEW-TICKET-REQUEST blocks. The MCP_TIMEOUT bump (`120000ms` in `~/.claude/settings.json`) is the mitigation for next session — but the underlying pattern (sub-agent runtime structurally lacks `mcp__clickup__clickup_create_task`; orch-side MCP is unreliable on cold-start) recurred AGAIN in M4 after recurring in M1 + M2 + M3. The deferred-creation-via-`clickup-pending.md` pattern handles it gracefully every time, but the friction adds up: every M4 dispatch had to route through the queue, every flush required a separate orch round, every Felix/Maya dispatch brief had to acknowledge the gap in its lifecycle block. This is the most-recurring infrastructure friction across V1 — promoted to durable lessons + V2 candidate (see "V1 close cross-arc retrospective" below).

- **`clickup-pending.md` log-only rebase conflict surfaced twice this session (PR #57 post-PR-#58 + PR #59 post-orch-flush).** Both cleanly recovered via the documented `git checkout --ours` auto-decide pattern (rule 6.6 promoted class from M2 retro). Each recovery cost ~1 minute. Cumulative across M2 + M3 + M4: hit ~10× across the V1 arc; recovery now mechanical. But the friction is consistent — the ENTRY scheme change from M3-05 (timestamps replacing `ENTRY-NNN`) eliminated the *ID-collision* class but did NOT eliminate the *both-add* class (when two PRs each append a timestamp-keyed entry concurrently). The recovery pattern handles both classes identically (`--ours` keeps main's already-merged entry; the second PR's branch retains its own pre-merge entry which is then a no-op on merge). The friction-per-incident is small enough that the open prevention question (single-writer-lock vs deeper schema change) has correctly stayed at low priority across V1 close — the recovery pattern IS the engineering-affordance accommodation.

- **Maya double-loaded on M4-02 + M4-05 with parallel-on-same-file risk.** Both touch `dashboard.css` and `agentTile.ts`. The backlog explicitly called out this risk in M4-02 § Conflict rule and M4-05 § Conflict rule + Dependencies section; the orchestrator dispatched both in parallel anyway with PR-body cross-reference as the coordination affordance. Both PRs landed within 30 min of each other without conflict because (a) Iris's M4-01 §5.4 vocabulary contract pre-named the identifiers, (b) Maya threaded her own coordination across both PRs (her M4-05 PR body explicitly cites M4-02's deprecated-hexes appendix as the source of literal-vs-token decisions), (c) the line ranges were genuinely non-overlapping (M4-02 owned `dashboard.css` selector blocks consuming new tokens; M4-05 owned new keyframes + state-rules + reduced-motion block; Felix M4-03 owned the `title` attribute additive line). It WORKED — but the win was structural (Iris's spec gave the parallel split a clean axis) more than tactical (orchestrator coordination). On a milestone where the spec doesn't pre-decompose surfaces cleanly, the same parallel dispatch would have produced overlap pain. The lesson: parallel-on-same-file is sometimes safe when the spec pre-decomposes the surfaces, but the orchestrator should grade this risk per-spec rather than trusting that "Iris's spec is detailed" is sufficient. M4 was lucky here; M5/V2 dispatches should not generalize the win without auditing the spec's surface-decomposition depth.

- **Felix's PR #57 verification approach (read-and-confirm-M2-carry-over) absorbed scope that could have been per-AC dispatches.** M4-03 AC2 (`cursor: pointer`) and AC4 (whole-tile click target) and AC5 (`tabindex="0"`, focus-visible, Enter/Space) were ALL satisfied by existing M2 implementations — Felix's PR added one line to `agentTile.ts` (the `title` attribute) + one preview-flag flip in `main.ts`. The "verify-and-confirm-no-edit" pattern paid out (no unnecessary CSS edits, no rebase footprint with M4-05) — but it depended on Felix reading the existing implementations carefully BEFORE dispatching edits. The risk model: if Felix had dispatched a `cursor: pointer` CSS edit without checking, M4-05's same-file `dashboard.css` ranges would have collided. The success here is honest scoping; the latent failure mode is dispatch-without-read on parallel-on-same-file tickets. Worth flagging for V2: when the dispatch brief includes ACs that *might* already be satisfied, the brief should explicitly require a read-and-confirm step before any edit, especially on parallel-dispatch surfaces.

## Surprising findings

- **The M4 wave was the smoothest of V1 despite having more parallel dispatches on shared files than any prior milestone.** M3-10 (Felix + Maya parallel on shared types) produced the vocabulary-divergence non-mergeable-PR incident. M4 had Felix + Maya parallel on `agentTile.ts` + `dashboard.css` (TWO shared files, not just types) AND it shipped cleanly. The difference is the design spec: M3-10 lacked an Iris pass; M4 had M4-01 §5.4 explicitly naming identifiers + §2.3 transition matrix decomposing the `agentTile.ts` surface into "state visuals" (Maya M4-05 owns) vs "drill-in affordance" (Felix M4-03 owns) vs "styling refactor" (Maya M4-02 owns). The Iris-leads pattern doesn't just shape dev briefs — it *decomposes the file surface into parallel-safe ownership zones*. This is a stronger claim than "Iris produces good specs"; it's that the design pass is doing parallel-coordination work, not just visual-decision work. Future milestones with parallel-on-same-file risk should explicitly look to the design phase to decompose the surface — not just rely on PR-body cross-references at dispatch time.

- **Never-fabricate rule shipped, was tested by M4-04 measurement, and held — same session.** PR #55 (never-fab rule propagation) merged at 07:38Z. PR #59 (M4-04 cadence + memory probe) merged at 08:52Z — Felix authored the memory probe section under the rule he'd just propagated. The framing held: "Plausibly clean — follow-up needed" instead of "no leak detected." Three named confounds, four follow-up-recommendation citations. This is the fastest rule-to-application cycle V1 produced — from rule landing on main to its first non-trivial test, ~75 minutes. Implication: when a discipline rule has a load-bearing application within the same milestone, codifying it FIRST (not retrospectively) pays out. The rule didn't just prevent regression; it shaped how Felix wrote the next deliverable.

- **M4 produced zero new global orchestrator-discipline rules — and that's the correct outcome.** M2 produced 0, M3 produced 5 (a record). M4 produced 0. The 5 M3 rules were authored in response to concrete incidents; the M4 wave was incident-free at the orchestration layer (the bash-orphan + ClickUp MCP friction were both already-codified failure modes). The rule velocity is converging toward zero — not because every failure mode is solved, but because the foundational orchestration disciplines (background dispatch, wake-signal, vocabulary contract, cross-session continuity, main-thread bloat, staleness verification, worktree concurrency) cover the high-leverage classes. Future milestones should produce 0 or 1 rule per cycle by default; >1 in a cycle is a signal that the foundation has a new gap. This is a sustainable steady-state — different from M3's crisis-driven cluster authoring.

- **Sponsor's "pointed-question" pattern (M3 lesson) did NOT trigger in M4.** No "are you stuck", no "can this be prevented", no large transcript paste. Two interpretations: (a) the M3 rules genuinely closed the orchestration gaps that triggered the pointed questions; (b) M4's compressed timeline + spec-driven dispatch sequence didn't surface conditions that would have produced a pointed question. Both are partially true. The 5 M3 rules cover the classes that triggered the M3 pointed questions (wake signals, session continuity, main-thread bloat, parallel vocabulary, staleness verification); M4's wave didn't stress those classes hard enough to test whether the rules genuinely prevent versus just defer. Verdict for retrospective purposes: the M3 rules earned their keep in M4 by absence-of-incident, but the test was relatively mild. M5/V2 will provide the harder test on a longer time horizon.

- **The 100% hash-skip rate in steady state validates the architecture choice from M2.** Felix's M4-04 measurement found 100% hash-skip rate in a 10-minute window with 3 live Claude Code sessions and 52 agents. The hash-skip optimization in `watcherLoop.ts` (M2-04) is the architectural decision that makes a 2-second poll cadence essentially free: the work happens only when state changes, and the FS-watcher catches inter-poll changes anyway. This validates a design choice from two milestones ago, retrospectively. Future cadence-tuning work should view this as the steady-state baseline: tuning the poll interval is the wrong knob; the architecture already amortized poll cost to ~zero in production.

## Patterns + anti-patterns to internalize

- **PATTERN — Iris-leads-with-spec decomposes parallel-safe ownership zones, not just visual decisions.** Validated 3× across V1 (M1-03 → M1-09, M2-03 → M2-05/06, M4-01 → M4-02/03/05). The design spec does *coordination work* by naming surfaces, decomposing files, and pre-deciding the parallel-safe boundaries. When the milestone has visual/UX surfaces, dispatch Iris first as a solo gate; the spec lets parallel dev dispatch ship cleanly on shared files.

- **PATTERN — Anti-fabrication framing on measurement-class deliverables.** Validated on M4-04. When the deliverable involves measured data (cadence, performance, memory), the verdict should explicitly enumerate confounds + recommend follow-up where the harness environment differs from production. "Plausibly clean — follow-up needed" is the right shape; "no leak detected" is the wrong shape when the measurement environment isn't production. Future measurement-class tickets (Felix's M4-04 heap-probe follow-up; any V2 perf work) should hold this bar.

- **PATTERN — Reversibility framing on user-facing polish decisions.** Validated on M4-03's `{ preview: true }` flag. When a polish decision is non-mechanical (i.e., sponsor dogfooding might prefer the opposite), ship with explicit reversibility framing in the PR body + a follow-up verdict point. Don't try to pre-decide what only emerges from real usage. The retro is the natural verdict point.

- **PATTERN — Vocabulary contract in the spec, not at dispatch time.** Validated on M4-01 §5.4 → M4-05 + M4-03 parallel dispatch. When the spec pre-names the identifiers (type names, attribute values, keyframe names, CSS custom property names, file paths), parallel dispatch can ship without rebase conflicts even on shared-file surfaces. The new parallel-agent-vocabulary-discipline rule's Pattern B works best when the spec itself carries the vocabulary contract block — not when the orchestrator authors it at dispatch time.

- **PATTERN — Self-referential proof in discipline-codifying PRs.** Validated on PR #55 (never-fab propagation). When a PR introduces or codifies a discipline rule, the PR body should follow the rule. Future discipline-PR authors should adopt this pattern: it makes the rule concrete in practice, surfaces edge cases at codification time, and produces a working example in the PR's audit trail.

- **ANTI-PATTERN — Sub-agent `run_in_background` for tasks that outlive the agent's reasoning loop.** When a sub-agent dispatches a background bash task (e.g., a 10-minute measurement probe), the bash process keeps running but the agent has no way to harvest the output before its session ends. The orchestrator-side recovery (WIP-resume + foreground-bash-with-`timeout`) works but burns a dispatch cycle. Prevention: sub-agents should use foreground `timeout <seconds> <command>` for long-running tasks, NOT `run_in_background` from within their reasoning loop. Codified in `.claude/docs/orchestration-overview.md` this session. The composition with user-global `[[always-background-dispatch-subagents]]` is: orchestrator dispatches sub-agents in background; sub-agents themselves run their internal commands in foreground.

- **ANTI-PATTERN — Adding a top-level dev-only TS directory without the triple-edit pattern.** Validated on M4-04's `scripts/` discovery. Any new top-level dev-only TS path (`scripts/`, `bench/`, `probe/`, etc.) needs three edits: (1) the source file, (2) `tsconfig.json` `include` for typecheck, (3) `.vscodeignore` exclusion so `vsce package` doesn't ship it. Missing any one produces either type errors or VSIX bloat or both. Codify in `vscode-extension-conventions.md` (promoted below).

- **ANTI-PATTERN — Generalizing parallel-on-same-file success without auditing the spec's surface-decomposition.** M4 shipped Felix + Maya parallel on `agentTile.ts` + `dashboard.css` cleanly — but that was structural (Iris's spec pre-decomposed the surface), not tactical. Future dispatches should not assume parallel-on-same-file is safe just because M4 succeeded; the safety came from spec design, not from orchestrator coordination at dispatch time. When the spec doesn't pre-decompose the surface, the orchestrator should either sequence the dispatches (Pattern A from the parallel-vocab rule) or invest in pre-dispatch surface-decomposition (extending the spec, or authoring a minimal pre-dispatch coordination doc).

## Durable lessons promoted

- **scripts/ triple-edit pattern** → `.claude/docs/vscode-extension-conventions.md` (promoted candidate). Pattern: any new top-level dev-only TS directory requires (1) source file, (2) `tsconfig.json` `include` entry, (3) `.vscodeignore` exclusion. Cite M4-04 PR #59 as the originating evidence. Felix flagged this explicitly as a maintain-docs candidate in his PR body.

- **tsx-vs-production-runtime heap measurement caveat** → `.claude/docs/testing-strategy.md` § Performance probes (promoted candidate). Pattern: measurement done under `tsx` will show retention that doesn't exist in the bundled `dist/extension/main.cjs` runtime. For definitive verdicts on memory posture, probe inside the actual extension host. Cite M4-04 as the originating evidence + Felix's "Plausibly clean — follow-up needed" framing as the right verdict shape.

- **100% hash-skip in steady state is the expected baseline** → `.claude/docs/architecture-overview.md` § Two-tier data plane (promoted candidate). The hash-skip optimization amortizes poll cost to ~zero in steady state because JSONL flushes are bursty (per `data-sources.md §3`). Future cadence-tuning work should treat 100% as the steady-state baseline, not an anomaly. Cite M4-04 measurement (10-min, 3 sessions, 52 agents → 100%) as evidence.

- **Sub-agent `run_in_background` orphan pattern** → already captured in `.claude/docs/orchestration-overview.md` this session (per the dispatch brief). This retro entry cross-references the existing doc.

- **Iris-leads-with-spec as parallel-decomposition mechanism (3× validated across V1)** → `.claude/docs/orchestration-overview.md` § Dispatch patterns (promoted candidate). Stronger claim than the M2-retro framing ("Iris-leads produces cleaner dev briefs"): the design pass *decomposes the file surface into parallel-safe ownership zones*. M1-03 → M1-09, M2-03 → M2-05/06, M4-01 → M4-02/03/05 are the three validating instances.

- **Self-referential proof in discipline-codifying PRs** → cross-project memory candidate (`[[discipline-pr-self-referential-proof]]`). Pattern is generalizable to any orchestrated project. Worth saving so future orchestrators in any project adopt the pattern when codifying new rules.

- **Anti-fabrication framing on measurement-class deliverables** → cross-project memory candidate (`[[measurement-class-anti-fabrication-framing]]`). Generalizable to any project producing measured data. Worth saving so the "Plausibly clean — follow-up needed" verbiage becomes the reflex for measurement PRs.

- **Cumulative auto-decide track record: 31/31 across V1 (M1+M2+M3+M4), 0 reversals.** Memory entry candidate (`[[auto-decide-v1-track-record]]`) — strongest possible validation of the autonomy framework's calibration. The promoted classes (rule 6.6 in user-global CLAUDE.md) all fired without sponsor revision. Future orchestrators in this project can lean into auto-decide with high confidence; future orchestrators in OTHER projects can cite this track record when pitching the framework's adoption.

## Next-session backlog

(M4 close also serves as V1 close — items below cover both M4-specific carry-overs AND V1 → post-V1 transition prep.)

1. **In-extension-host heap snapshot probe (Felix M4-04 recommendation).** Replicate the +4.6 MB / 10 min tsx-harness measurement under real VS Code extension-host runtime to confirm or refute the memory delta. Maya endorsed this as NIT-class in her M4-04 review. Filed via `clickup-pending.md` NEW-TICKET-REQUEST (sub-agent runtime lacks `mcp__clickup__clickup_create_task`). XS-S size; Felix-owned; Maya peer-review.

2. **Maintain-docs candidates from PR #59 (three Felix-observed patterns).** Promote to `.claude/docs/` per the durable-lessons-promoted section above: (a) scripts/ triple-edit pattern → `vscode-extension-conventions.md`; (b) tsx-vs-production heap caveat → `testing-strategy.md`; (c) 100% hash-skip steady state → `architecture-overview.md`. Either via orch-direct doc PR or via the maintain-docs Stop-hook on a future turn. Cite M4-04 as origin.

3. **Outstanding follow-up tickets at V1 close — reassess scope:**
   - `86c9yb0yg` — M3-01 NITs (Felix XS, sponsor-held to bundle with M4). M4 didn't surface a natural absorption point; reassess as standalone post-V1 chore or retire if no longer relevant.
   - `86c9ydz4k` — formatFreshness NIT (absorbed into PR #47 per M3 retro; orchestrator confirms `complete` if not already flipped).
   - `86c9yee3g` — PR #47 cosmetic NITs (Maya XS, mechanical) — completed via PR #50 per M3 retro; verify final state.
   - `86c9y7y9z` — M2-04 NITs — closed as phantom this session per decision log `2026-05-25 0540 UTC` (M2-06 PR #28 absorbed both NITs).

4. **Decisions-log batch PR (Nora weekly cadence).** Collect `Decision draft:` lines from M4 merged PRs + the cumulative across V1. Candidates: (a) marketplace publication deferral (PR #53 Decision drafts); (b) Iris-leads sequencing as M4 + V1-wide pattern; (c) `{ preview: true }` flag for drill-in (PR #57); (d) keep `pollIntervalMs: 2000` based on empirical validation (PR #59); (e) Iris-leads-decomposes-parallel-zones meta-pattern (this retro's surprising finding #1); (f) auto-decide track record 31/31 cross-V1 calibration confirmation.

5. **Marketplace publication milestone kickoff.** Sponsor decision needed: when to start the post-V1 marketplace milestone? Scope candidates: publisher account setup, README/CHANGELOG/LICENSE polish, marketplace icon design (Iris), `vsce publish` gates, telemetry decisions, support-channel plan. Pre-dispatch Bram research on (a) VS Code Marketplace publishing requirements + recent policy changes, (b) other Claude-related extensions on the marketplace for positioning + naming-collision check, (c) telemetry-disclosure best practices for open-source utility extensions.

6. **Cross-project porting candidates for `create-orchestration-project` skill.** All 6 global orchestrator-discipline rules from M3 + the new patterns from this M4/V1 retro are cross-project. File against the skill's `port-improvements` mode (separate from ClaudeTeam's own repo). Specific candidates: (a) Iris-leads-decomposes-parallel-zones, (b) anti-fabrication framing on measurement deliverables, (c) self-referential proof in discipline-PRs, (d) scripts/ triple-edit pattern (project-template-level), (e) the auto-decide 31/31 track record as a recommendation for new projects' autonomy calibration starting point.

7. **V2 candidate-list — sponsor input needed for prioritization.** See V1 close cross-arc retrospective below (V2 candidate-list section). Marketplace publication is the headline deferral; other candidates surfaced via V1-PLAN OOS + M4 dogfooding + deferred ClickUp tickets.

8. **`auto-status away` cadence revisit deferred from M3.** The 15-min AWAY interval may be too coarse given the staleness-verification ritual. M4 didn't stress the AWAY mode (sponsor was active for most of M4); revisit when a real AWAY session with 3+ in-flight agents tests the verification ritual's cost.

---

# V1 close cross-arc retrospective

This section covers the M1 → M2 → M3 → M4 arc as one deliverable (V1).

## What V1 shipped

A VS Code extension that surfaces orchestrated Claude Code agent teams via a sponsor-curated roster. The end-to-end happy path: sponsor edits `~/.claudeteam/teams.yaml`; the extension's file-watcher detects the change within ~1 second; the dashboard webview reflects the new roster against live agent state from `~/.claude/sessions/` + `~/.claude/projects/*/subagents/` — rostered tiles per matched persona-name; background-noise chip per session for unrostered agents; collapsed `Felix ×N` headers when multiple instances of a rostered persona run concurrently; drill-in click opens the agent's JSONL in a VS Code preview tab; status visuals telegraph running / idle / finished / error state with reduced-motion respect + theme-aware styling.

The roster-matcher thesis from M1 ("sponsor-curated roster collapses everything else as background noise") is empirically validated end-to-end. Six personas / 25-35 implementation tickets / 0 reverts / 0 broken-main events / 31 auto-merges with 0 reversals across four milestones.

## What changed across M1 → M2 → M3 → M4

- **M1 — Data-Spike CLI.** Validated the parsers + roster matcher + reducer behind a throwaway CLI. Output: `npm run agent-tree` works end-to-end against live `~/.claude/`. Tests: 99 unit + 31 integration = 130.
- **M2 — Extension scaffold + webview.** Wired M1's data plane into a real VS Code extension. Webview renders rostered tiles + background-noise chips; file-watcher loop runs the production data plane; `.vsix` installs and activates. Tests: 215 unit + 49 integration + 14 Layer-3 = 278 (+148 net).
- **M3 — Roster config + live refresh.** Hot-reload YAML watching (~1s); auto-create starter YAML on first `claudeteam.openRoster`; window-scoped session filtering; roster-error chip; persona-tile collapse for N>1 same-persona dispatches. Tests: 353 passing + 3 skipped unit + 68 integration + 23 Layer-3 = 444 passing (+166 net).
- **M4 — Live polish.** `--ct-*` token system; theme-mapping refactor; status-state visuals + 12-cell transition matrix; drill-in affordance polish (tooltip, preview-flag, keyboard); cadence tuning measurement + memory probe (decision: keep `pollIntervalMs: 2000`, no adaptive). Tests: 386 passing + 2 skipped unit + 68 integration + 23 Layer-3 = 477 passing (+33 net).

The arc is data → scaffold → config → polish. M1 is the "does the architecture work?" gate; M2 is the "does it work in the target runtime?" gate; M3 is the "is it usable by the sponsor?" gate; M4 is the "does it feel polished?" gate. Each milestone gates on a different question; the structure is reusable for V2 / future projects.

## What stayed stable

- **Orchestration model: orchestrator never codes.** Across 25-35 implementation tickets, the orchestrator dispatched + gated + merged but never edited source. The model held under load (Wave 1 of M3 had 5–6 agents in flight; M4 had 4 agents in parallel). No degradation under scale.
- **6-persona roster: Nora / Iris / Felix / Maya / Sage / Bram.** Same six roles across V1. Each role's surface stayed stable: Nora authored 4 backlogs + 4 retros + 1 weekly-batch decisions PR cadence; Iris authored 3 design specs (CLI output, dashboard tile, M4 polish) + reviewed visual PRs; Felix + Maya did dev work + cross-reviewed each other on every PR; Sage authored 1 test plan + 2 Layer-3 expansion tickets + QA'd all dev work; Bram did 2 prior-art research dispatches (M2 + M3) feeding implementation.
- **Cross-review pairing (Felix ↔ Maya).** Held 31/31 PRs. Zero self-merges. Iris's design PRs reviewed by Maya for visuals or Felix for spec edges; Sage's test PRs reviewed by Felix; Bram's research PRs reviewed by Felix; Nora's PRs orch-direct. The "no PR ships without a peer-reviewer APPROVE" rule held without exception.
- **ClickUp 4-state workflow (`to do → in progress → in review → complete`).** Across ~30 tickets; sub-agent runtime gaps on `mcp__clickup__update_task` and `mcp__clickup__clickup_create_task` were the recurring infrastructure friction (M1 + M2 + M3 + M4) — every milestone routed around via `clickup-pending.md` NEW-TICKET-REQUEST + STATUS-FLIP-REQUEST blocks. The workflow itself stayed stable; only the access path was friction.
- **Sponsor speaks only to the orchestrator.** Held across V1. Sponsor never directly dispatched a persona; sponsor never directly edited a PR. The orchestrator was the single point of contact, the single point of decision, the single point of audit-trail.
- **`main` is protected; admin-merge after peer APPROVE + CI green.** Held across V1. No force-merge. No bypassed CI. The webview-smoke gate (CLAUDE.md hard rule #3) and extension-manifest gate (rule #4) held throughout — with the documented sub-agent GUI gap reframe for AC(a) data-plane smoke + AC(b–d) sponsor-side post-merge.

## What failure modes recurred across milestones

- **Sub-agent runtime tool gaps (M1 / M2 / M3 / M4 — most recurring class).** `mcp__clickup__clickup_create_task` and `mcp__clickup__update_task` listed in persona files but not exposed at sub-agent runtime. Surfaced first in M1 (Bram's probe), workaround built (pending-queue in `clickup-pending.md`), recurred every milestone. Permission-rule allowlist + orch-side MCP loading handled the access path; the sub-agent gap is permanent harness behavior. Same gap likely affects every orchestrated project on this machine. Worth porting the workaround to `create-orchestration-project` skill template.

- **`clickup-pending.md` rebase conflicts (M2 / M3 / M4).** ENTRY-NNN collisions in M2 (4×); switched to timestamp-based IDs in M3-05; both-add conflicts continued in M3 + M4 (~6× more, but each recovery is mechanical via `git checkout --ours` per the rule-6.6 promoted auto-decide class). Total ~10× across V1; each ~1 minute to recover. Not solved structurally; the recovery pattern IS the engineering-affordance accommodation.

- **Chain-of-deferred-validations (M2 lesson, applied in M3 + M4).** M2-01 deferred screenshots to M2-05 (placeholder-PR exception); M2-06 deferred screenshots to sponsor post-merge (sub-agent GUI gap). The chain meant `.vsix` install path was never exercised by a human until Layer-3 caught the activation bug. M3 + M4 honored the M2-retro rule: bind install-validation to the FIRST shipping PR. Did not recur as a production-bug-discovery class in M3 or M4.

- **Vocabulary divergence on parallel-shared-concept dispatch (M3 lesson, prevented in M4).** M3-10 produced the type-name divergence + non-mergeable-PR incident. M4-05 + M4-03 (Felix + Maya parallel on `agentTile.ts` + `dashboard.css`) shipped cleanly because M4-01 §5.4 pre-named the identifiers + decomposed the surface. The Pattern B (spec carries vocabulary contract) of the new global rule paid out the first time it was tested.

- **Main-thread bloat surfaces (M3 lesson, partially held in M4).** M3 produced the 10-pattern bloat-discipline rule. M4 was relatively quiet on the bloat front — no large transcript pastes from sponsor — but anecdotally the orchestrator probably still produced some bloat (predictive trailers, redundant `gh pr view` state-checks, etc.). The rule is in user-global now; M4 didn't stress-test whether it actually prevents regression. Future milestones with longer arcs will provide a harder test.

## What shipped vs deferred

### V1 ship-list (one sentence per merged ticket M1 → M4)

**M1 (Data-Spike CLI):**

- **M1-01** (PR #4 → recovered `f870bef`) — TypeScript scaffold + CI pipeline (typecheck + lint + unit + integration jobs).
- **M1-02** (PR #5 → #6) — 7 fixture captures of `meta.json` schemas (v2.1.119 + v2.1.145 + the surprise v2.1.145-persona variant).
- **M1-03** (PR #3) — Iris CLI output spec defining glyph table + state vocabulary + role/display/activity/model field names.
- **M1-04** (PR #7) — Sage M1 test plan codifying unit / integration test layers.
- **M1-05** (PR #11) — `meta.json` parser supporting all three schema variants via a 3-tag `AgentMeta` union.
- **M1-06** (PR #12) — Subagent JSONL tailer extracting last-activity timestamps + recent tool calls.
- **M1-07** (PR #13) — Sessions/PID registry tracking liveness via process probe.
- **M1-08** (PR #10) — Roster YAML loader + matcher (sponsor-curated roster matches against persona-name / system-prompt / file-pattern rules).
- **M1-09** (PR #14) — Reducer + agent-tree CLI driver (`npm run agent-tree` end-to-end against live `~/.claude/`).
- **M1-09-followup** (PR #18) — 5 NITs cleanup (dead stub code, module-level mutable state extraction, plural-guard, tool-arg limitation, edge case in `buildActivity`).
- **M1-10** (PR #15) — Integration tests against fixture filesystem (31 tests covering all 4 happy paths + 6 edge cases).
- **M1-11** (PR #9) — Data-sources doc update reflecting the 3-variant `AgentMeta` schema reality.

**M2 (Extension scaffold + webview):**

- **M2-01** (PR #22) — VS Code extension manifest + esbuild build pipeline + lazy activation on `onView:claudeteam.dashboard`.
- **M2-01-followup** (PR #26) — 3 NITs cleanup (testing-strategy placeholder-PR exception, `package.json` `"when":"true"` removal, NIT #3 moot-closure).
- **M2-02** — Bram prior-art research (vanilla TS vs React, chokidar vs `createFileSystemWatcher`, IIFE bundling, lazy activation).
- **M2-03** (PR #20) — Iris dashboard tile spec — webview layout + interaction contract.
- **M2-03-followup** (PR #27) — 6 spec NITs (DashboardState/AgentTree aliasing, StateDelta shape, `ui:open-roster` path exposure, alive-state wireframe drift, connector glyph aria-hidden, Refresh button placement).
- **M2-04** (PR #23) — File-watcher polling loop with hash-skip optimization + dispose path; M2-04 NITs absorbed into M2-06 (Path Y).
- **M2-05** (PR #24) — Webview tile renderer + message receiver (vanilla TS, no framework).
- **M2-05-followup** (PR #25) — 3 NITs (messageReceiver tests + SELF-TEST typo fix).
- **M2-06** (PR #28) — Host ↔ webview integration; M2-04 NITs #1+#2 absorbed (subscription leak fix + `SerializedStateFullMessage` typed union); live `claudeteam-alpha` team materialized end-to-end.
- **M2-07** (PR #21) — Sage M2 acceptance test plan + webview-smoke gate spec.
- **M2-08** (PR #29) — Layer-3 `@vscode/test-electron` test suite (14 tests via xvfb-run on Ubuntu CI).
- **M2-09** (PR #19) — Dispatch-template tightening + APPROVE_WITH_NITS verdict enumeration.
- **`86c9y9yzu`** (PR #30) — CJS shim P0 fix for Node 22+ `require()` activation failure (surfaced by M2-08 Layer-3, fixed within hours).

**M3 (Roster config + live refresh):**

- **M3 prior-art** (PR #32) — Bram research on VS Code settings-UI patterns + `createFileSystemWatcher` for paths outside workspace folders.
- **M3 backlog** (PR #33) — Nora 9-ticket M3 backlog.
- **M3-05** (PR #34) — Timestamp-based ENTRY IDs replacing ENTRY-NNN sequential scheme in `clickup-pending.md`.
- **M3-01** (PR #35) — Live YAML watch + hot-reload at `~/.claudeteam/teams.yaml` (~1s refresh, no `Reload Window`).
- **M3-01-followup** (PR #40) — 2 NITs (`rosterPollIntervalMs` description-vs-clamp + PR-claim discipline note).
- **M3-06** (PR #36) — Test-plan executor-mapping discipline for sub-agent GUI gap awareness.
- **M3-02** (PR #37) — `claudeteam.openRoster` command + auto-create starter YAML on first invocation.
- **M3-03** (PR #38) — Window-scoped session filtering by current VS Code workspace.
- **M3-04** (PR #39) — Roster-error chip + filtered-empty state + `Edit Roster` button.
- **`86c9ybrk0`** (PR #41) — Webview-boot fixture leak fix (DEAD session bleed past window-scope filter).
- **M3-07** (PR #42) — Install-path validation discipline at first-shipping PR.
- **M3-08** (PR #43) — Main-thread merge-narration tightening.
- **M3-09** (PR #44) — Sage Layer-3 expansion: YAML hot-reload + window-filter + roster-error chip (9 new Layer-3 tests + 13 bonus NIT-coverage unit tests).
- **M3-04 NITs host** (PR #45) — Felix parse-error model fallback + human-readable error format (`86c9ybtut`).
- **M3-04 NITs webview** (PR #46) — Maya finished-status freshness suffix (Xs/Xm/Xh).
- **M3-10 webview** (PR #47) — Persona-tile-collapse renderer + freshness rollover NIT absorbed (`86c9ydz4k`).
- **M3-10 host** (PR #48) — Persona-tile-collapse reducer grouping + config flag (post-reconciliation rebase after vocabulary-divergence incident).
- **PR #47 NITs** (PR #50) — Maya cosmetic NITs (collapsedPersonaTile JSDoc + defensive count).
- **M3 retro** (PR #49) — Nora M3-close retro.
- **M3 retro NIT fix** (PR #51) — Test-count off-by-one correction.

**M4 (Live polish — V1 close):**

- **Dispatch-template detach codification** (PR #52) — `git switch --detach HEAD` mandatory final step in dispatch template.
- **M4 backlog** (PR #53) — Nora 6-ticket M4 backlog with Iris-leads sequencing.
- **M4-01** (PR #54) — Iris three-part design spec: 20-token system + 12-cell transition matrix + drill-in affordance model.
- **Never-fabricate propagation** (PR #55) — Rule 10 added to project CLAUDE.md + anti-fabrication contract section in dispatch-template.
- **M4-02** (PR #56) — `--ct-*` styling tokens + theme-mapping refactor consuming M4-01 §1.
- **M4-03** (PR #57) — Drill-in affordance polish: tooltip + preview-flag + keyboard activation + AC verifications.
- **M4-05** (PR #58) — Status-state visuals + transition matrix + reduced-motion fallback per M4-01 §2.
- **M4-04** (PR #59) — Cadence tuning + memory probe (decision: keep `pollIntervalMs: 2000`, no adaptive cadence, follow-up extension-host heap probe recommended).
- **M4-06** (this PR) — M4 retro + V1 close cross-arc retrospective.

### V2 candidate-list (one-line rationale + S/M/L cost)

Sources: V1-PLAN OOS items + M4 dogfooding observations + deferred ClickUp tickets at V1 close.

- **Marketplace publication milestone (headline V1 deferral) — L.** Publisher account setup, README/CHANGELOG/LICENSE polish, marketplace icon (Iris), `vsce publish` gates, telemetry decisions, support-channel plan. Pre-dispatch Bram research on marketplace policies + competitive landscape.
- **In-extension-host heap snapshot probe (Felix M4-04 follow-up) — S.** Replicate tsx-harness measurement under real VS Code extension-host runtime. Confirm or refute the +4.6 MB / 10 min delta. NIT-class deliverable.
- **Hook-tap sub-second activity updates (V1-PLAN line 34 — explicit V1 OOS) — M.** Replace polling-only data path with hook-driven push for sub-second activity updates. Promote if cadence measurement surfaces a real need (M4-04 found none — the architecture amortizes poll cost to ~zero, so the case for hook-tap is weaker now than at V1-PLAN time).
- **In-webview transcript drill-in (V1-PLAN line 32 — explicit V1 OOS) — M.** Render the agent's JSONL inside the webview instead of opening VS Code's native file viewer. Bigger UX surface; needs Iris design pass for the panel layout.
- **Sparkline / activity ribbons (M3 retro candidate, didn't make M4 sponsor scope) — S-M.** Visual ribbon per agent tile showing recent tool-call frequency. Iris design needed first.
- **Settings-UI form for roster editing (V1-PLAN OOS; M3-02 chose commands-only) — M.** Webview-based form for sponsors who prefer GUI over YAML. Bram's M3 research informed the V1 choice; V2 could revisit.
- **Per-session cadence overrides (M4-04 OOS) — S.** Allow different `pollIntervalMs` per session/workspace. M4-04 found no measurable need; defer unless dogfooding surfaces one.
- **Telemetry — usage metrics (post-V1 marketplace need) — M.** Lightweight opt-in telemetry for usage patterns, error rates. Tied to marketplace publication; needs disclosure-policy decisions.
- **Roster vocabulary expansion: match-rules beyond persona-name (V1-PLAN OOS) — S-M.** Currently matches on persona-name + system-prompt + file-pattern. V2 could add tool-name match (e.g., "roster anyone using `mcp__clickup__*`"), session-cwd match (e.g., "roster anyone working in `~/work/marian-tutor`"). Bram research candidate.
- **Multi-workspace dashboard panel (V1 = single VS Code window) — L.** Show agents across all currently-open VS Code windows simultaneously. M3-03 explicitly window-scoped; V2 could add an "all windows" toggle. Big surface — needs IPC between extension instances or shared state file.
- **Adaptive cadence (M4-04 OOS) — S.** Faster polling when FS-watcher recently fired, slower when state has been quiet. M4-04 measurement found no real need; defer unless dogfooding surfaces one.
- **`auto-status away` cadence revisit (M3 retro carry-over) — XS.** Tighten AWAY interval to ~10 min when 3+ agents in flight, OR document that the verification ritual auto-batches `TaskOutput` + `git fetch` calls.
- **Decisions-log batch PR weekly cadence enforcement (Nora process candidate) — XS.** Set up a scheduled Nora dispatch to batch `Decision draft:` lines into `team/DECISIONS.md`. Currently ad-hoc; cadence would close audit-trail gaps.
- **Single-writer-lock for `clickup-pending.md` (recurring V1 friction) — S-M.** Eliminate both-add log conflicts entirely via a per-write file lock or per-persona log fragment scheme. Currently the `--ours` recovery pattern works; this would eliminate it. Worth the cost only if V2 volume exceeds V1's ~10 conflicts.

---

## Closing note

V1 shipped. The roster-matcher thesis works against real data; the orchestration model held across 4 milestones; 31 auto-merges with 0 reversals validates the autonomy framework; the 6-persona roster scaled cleanly from M1's data spike through M4's polish. The team learned how to author parallel dispatches safely (M3 lesson, applied in M4); how to frame measurement-class deliverables honestly (M4 lesson, codified for V2); how to decompose UX surfaces into parallel-safe ownership zones via Iris-leads design specs (cross-V1 pattern, validated 3×).

The single recurring infrastructure friction across V1 — sub-agent `mcp__clickup__*` runtime gaps — is now a known-class problem with a working workaround. Worth porting to `create-orchestration-project` skill template so future projects start with the gap acknowledged + the workaround pre-installed.

Marketplace publication is the headline post-V1 deferral. V1 dogfooding informs whether/when to publish; the V2 candidate-list above gives the sponsor the menu when they're ready to scope the next milestone.

M4 closes V1.
