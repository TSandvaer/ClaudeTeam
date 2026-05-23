# Risk Register — ClaudeTeam V1

Top risks across the V1 program. Reviewed at each milestone retro; status flips between `held` (active), `fired` (the risk hit), `demoted` (no longer relevant).

| ID | Risk | First raised | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| R1 | Schema drift between v2.1.119 / v2.1.145 not fully captured — parser passes on captured fixtures but breaks on a third schema variant. | M1 plan | Bram + Felix | Bram captures both schemas live (M1-02); parser feature-detects (M1-05); Sage probes missing-field cases. Re-probe when Claude Code minor versions bump. | held |
| R2 | JSONL flush cadence ≥ 2s means polling at 2s + disk staleness blows up "live activity" feel. | M1 plan | Felix | M1 accepts the 2s staleness; M4 tunes polling cadence (possibly chokidar / event-based). Flag if M1's CLI output feels stale in real use. | held |
| R3 | `gh pr review --approve` may be blocked by shared git identity — peer-review gate stalls. | M1 plan, from `orchestration-overview.md` | orchestrator | Documented fallback: `gh pr comment` with "APPROVE" text. Verify on M1-01 PR. | held |
| R4 | Felix is single-threaded on M1 — 6 of 10 tickets land on his lane. If he blocks, M1 stops. | M1 plan | Nora | Sequence carefully — independent parser tickets (M1-05/06/07/08) fire as a wave; Maya keeps PRs moving via fast review. M2 redistributes. | held |
| R5 | `vsce package` toolchain not verified locally — extension-manifest gate (CLAUDE.md hard rule #4) requires it; if vsce broken, every M2+ manifest-touching PR stalls. | M1 plan | Felix (M1-01) | M1-01 includes a `vsce --version` smoke check. Sponsor confirms install if it fails. | held |

## Retired risks

(none yet — milestone retros will populate this)

## Process

- This file is appended on the first task of every milestone (Nora authors).
- Each retro reviews the existing entries, flips status, and adds new entries for risks discovered in the milestone.
- Top 3–5 active risks at any time — if the list grows past 5, demote weaker entries.
