# ClaudeTeam — Project Brief

ClaudeTeam is a **VS Code extension** that provides an accurate, real-time dashboard of orchestrated Claude Code agent teams. It surfaces named team agents (defined by a sponsor-curated roster) and collapses the rest as background noise. See [docs/V1-PLAN.md](docs/V1-PLAN.md) for the full V1 plan.

## Orchestrator model

The Claude Code main session is the **orchestrator**. Six named-role sub-agents (Nora, Iris, Felix, Maya, Sage, Bram) handle dispatched work, each in their own per-role git worktree. **The orchestrator never codes** — it briefs, dispatches, gates, and merges. Sponsor (Thomas) speaks only to the orchestrator.

## Hard rules (non-negotiable)

1. **`main` is protected (team discipline)** — orchestration-doc updates can land directly while we bootstrap; once the extension scaffold lands, all PRs go through `gh pr merge --admin --squash --delete-branch`. Branch protection is NOT yet enforced server-side.
2. **Testing bar** — paired tests + green CI + Sage sign-off before "complete." Sponsor will not debug.
3. **Webview-smoke gate** — any PR touching webview rendering or extension-host message-passing requires Maya (or the PR author) to post a Self-Test Report confirming a manual webview reload in VS Code worked end-to-end.
4. **Extension-manifest gate** — any PR touching `package.json` (contributes / activationEvents / engines) must include `vsce package --no-yarn` output (or equivalent) in the Self-Test Report.
5. **ClickUp status as hard gate** — every dispatch / PR-open / merge pairs with a ClickUp status flip in the same tool round.
6. **Orchestrator never codes** — dispatches from symptoms, never greps/traces/edits source.
7. **Always parallel dispatch** — every tick aims for 3–5 agents in flight; tickets aren't progress, dispatches are.
8. **Tightened final-report contract** — sub-agent reports ≤200 words; PR URL + verdict + blockers + doc-updates line. State claims (CI, tests, webview smoke) must cite verifiable evidence (run-id URL / SHA / file:line / screenshot). **Rationale:** verbose sub-agent reports flooding the orchestrator's main conversation window is the dominant context-bloat surface; detailed content goes in PR body / Self-Test Report comment / `team/<role>/` notes — NOT the orchestrator-bound message.
9. **CI-status command discipline** — when checking "is CI green?" for a merge-gate decision, use `gh pr view <num> --json statusCheckRollup -q '.statusCheckRollup[] | {name, status, conclusion}'` OR `gh run view <run-id> --json status,conclusion` (both authoritative). Do NOT rely on `gh pr checks <num>` for merge decisions — it caches "pending" for 2+ hours after the underlying run completes, burning polling cycles. Sanity check: any "pending" >30min → drill in with the authoritative command before concluding "still waiting".
10. **Never fabricate, never guess, never extrapolate** — concrete values (URLs, IDs, SHAs, file paths, command output, ticket / run IDs, file:line refs) must be fetched from a real source, never invented or extrapolated from sibling patterns. Sub-agents do NOT inherit user-global `~/.claude/CLAUDE.md`; this project-level rule is the inheritance surface and `.claude/agents/dispatch-template.md § Anti-fabrication contract` enumerates the sourcing commands.
    - **No pattern extrapolation.** PR preview URLs, deployment slugs, hashes, ticket IDs, SHAs, generated paths are NOT predictable from siblings — the hash suffix is generated; you have no way to know it without fetching it. Pattern-completion ("the slug probably follows X-Y-Z") is the failure mode this rule exists to prevent.
    - **Fetch, don't guess.** PR URL: `gh pr view <num> --json url -q .url`. Ticket state: `mcp__clickup__clickup_get_task` (orch-side). SHA: `git log -1 --format=%H` or `git rev-parse HEAD`. File:line: `grep -n <pattern> <file>` on the live file. CI run ID: `gh run list --limit 1`. If you can't fetch right now, say so explicitly — "I don't have X — let me check" beats a plausible-looking value that fails on use.
    - **STOP-and-verify signal phrases.** "Should be at...", "probably...", "lives in...", "is the same as..." used without a concrete check behind them = STOP and verify before stating the value. The rule extends beyond concrete values to claims about state (where a file lives, whether two things are the same, what scope a setting has) — same failure mode.
    - **Observed-symptom claims need a real source in the same paragraph.** PR bodies, Self-Test Reports, ticket comments, `process-incidents.md` entries: every concrete value (session ID, PID, file path, SHA, command output snippet, error text, screenshot caption) must be quoted from a verifiable source you just generated — tool output, file you just read, user-provided text. Phrasings like "Dashboard shows X", "Output was Y", "Concrete instance: <value>" read as observed reality and create false evidence if invented.
    - **Label hypotheses explicitly.** If the symptom is inferred / predicted / not directly observed, prefix it: `Hypothesis:`, `Likely:`, `Predicted symptom (verify before patching):`, or `Speculative — no source yet`. A future reader (often a sub-agent dispatched against the ticket) cannot distinguish your observation from your invention if you don't mark which is which.
    - **Cost asymmetry.** Pausing to verify is cheap (one tool call). A bad URL / SHA / path / fabricated observation is expensive — developers waste hours chasing fake repro paths; trust degrades fast and recovers slowly.

## Autonomy

Defers to user-global CLAUDE.md "Orchestrator autonomy" rule. Every autonomous orchestrator decision is logged to [.claude/decisions-while-away.md](.claude/decisions-while-away.md) with `Foundation:`, `Alternative:`, `Reversibility:`, `Status:` fields. Calibration target: 5–10% reversal rate.

The reviewer-track gate is hard: every code PR requires a peer `APPROVE` comment from the designated reviewer before the orchestrator admin-merges. No self-merge. Cross-review pairing: **Felix ↔ Maya** (devs review each other), **Sage** QAs both, **Iris** design PRs reviewed by Maya for visuals or Felix for spec edges.

## Coordination state (anti-bloat scaffolding)

ClaudeTeam separates coordination state across four files by access pattern, so the main conversation window doesn't have to carry it:

- **[team/STATE.md](team/STATE.md)** — between-tick source of truth. Read on resume; updated as state changes. Each role owns one section.
- **[team/DECISIONS.md](team/DECISIONS.md)** — append-only team-level decisions log (broader than `.claude/decisions-while-away.md` — covers sponsor calls, structural choices, retro-driven changes).
- **[team/log/process-incidents.md](team/log/process-incidents.md)** — append-only chronicle of failure modes (symptom / cause / recovery / prevention). Lazy-loaded — `.claude/docs/orchestration-overview.md` keeps only the terse stable rules.
- **[.claude/retros/](.claude/retros/)** — per-milestone retros. Promote durable lessons to `.claude/docs/` / memory / `process-incidents.md`. Use [`RETRO-TEMPLATE.md`](.claude/retros/RETRO-TEMPLATE.md) as the starting point.

## ClickUp board

- Workspace: `90151646138`
- List (**ClaudeTeam** board): `901523520912`
- Space (TSandvaer Development): `90156932495`
- Status workflow (4-state, case-sensitive): `to do` → `in progress` → `in review` → `complete`
- Movement responsibilities: developer/persona owns `to do → in progress` on dispatch and `in progress → in review` on PR open; orchestrator moves `in review → complete` after merge.

## Detailed Documentation

All files below are auto-loaded into context at session start via the [`session-start-read-docs.sh`](.claude/hooks/session-start-read-docs.sh) hook. Sub-agents do NOT inherit that load — they read these files themselves on their first task of a session.

- [architecture-overview.md](.claude/docs/architecture-overview.md) — V1 architecture: file-watcher data plane, two-tier promotion, roster matcher.
- [data-sources.md](.claude/docs/data-sources.md) — exact paths and schemas for `~/.claude/sessions/`, project JSONLs, subagent meta.json (both v2.1.119 and v2.1.145).
- [roster-matching.md](.claude/docs/roster-matching.md) — roster YAML schema and match-rule resolution order.
- [vscode-extension-conventions.md](.claude/docs/vscode-extension-conventions.md) — extension scaffold patterns, webview message protocol, activation events.
- [testing-strategy.md](.claude/docs/testing-strategy.md) — unit / integration / manual layers.
- [orchestration-overview.md](.claude/docs/orchestration-overview.md) — dispatch, worktrees, PR/merge protocol.
- [persona-pixel-character-animation-prompts.md](.claude/docs/persona-pixel-character-animation-prompts.md) — v3 custom animation prompt-engineering rules + validated prompts for the persona-character feature; cross-refs RandomGame's general PixelLab pipeline doc.

The [`maintain-docs`](.claude/skills/maintain-docs/SKILL.md) skill (auto-triggered after every turn via Stop hook) reviews each turn for non-obvious findings worth capturing here and updates this index when new doc files are created.

## Sub-agent docs preload (load-bearing)

If you are a sub-agent spawned via the `Agent` tool, you do NOT inherit the SessionStart auto-load. Before starting any work, read every `.claude/docs/*.md` file (in parallel via multiple Read calls in one message).
