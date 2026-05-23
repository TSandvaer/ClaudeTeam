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

The [`maintain-docs`](.claude/skills/maintain-docs/SKILL.md) skill (auto-triggered after every turn via Stop hook) reviews each turn for non-obvious findings worth capturing here and updates this index when new doc files are created.

## Sub-agent docs preload (load-bearing)

If you are a sub-agent spawned via the `Agent` tool, you do NOT inherit the SessionStart auto-load. Before starting any work, read every `.claude/docs/*.md` file (in parallel via multiple Read calls in one message).
