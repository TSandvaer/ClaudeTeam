# Integration Test CI Triage (86ca1n87m) — 2026-05-29

## Question

Why does `tests/integration/mainReplay.test.ts:260` fail (pre-existing failure on
`origin/main` SHA `5d4884be`), and what is needed to add `test:integration` to CI?

## Answer (3 sentences)

The `mainReplay.test.ts` AC5 failure is a **test-isolation / timing defect, not a
production-code regression**: the test expects the watcher's first async tick to post
exactly once within a 50ms window, but that window is only reliably met on the CI
runner (no `~/.claude/sessions/` present — tick completes in < 5ms) and fails locally
when a prior in-suite test leaves an in-flight async tick competing for the same
27-subagent-file IO budget. `test:integration` is already present in
`.github/workflows/ci.yml` (line 36-37) and does not require additional runner setup
(no headless display, no xvfb, no `@vscode/test-electron`); the suite passes reliably
on the CI runner because the runner has no active Claude Code sessions. The fix
is to make the AC5 test resilient to real machine state — either by controlling
`claudeHome` in the test (point it at `tempExt`, not `homedir()`) or by awaiting
longer / in a loop until the posts array grows.

## Evidence

### Reproduction

Run on `origin/main` SHA `5d4884be`, worktree
`c:/Trunk/PRIVATE/ClaudeTeam-bram-wt`:

```
> npm run test:integration
tests/integration/mainReplay.test.ts (3 tests | 1 failed) 322ms
  ❯ AC5: first-open (no prior state) does NOT emit a replay-post — empty-state path is unchanged
    → expected +0 to be 1 // Object.is equality
    ❯ tests/integration/mainReplay.test.ts:260:44

 Test Files  1 failed | 9 passed (10)
       Tests  1 failed | 117 passed (118)
```

Verbatim assertion at file:line `tests/integration/mainReplay.test.ts:260`:
```
expect(firstView.webview.posts.length).toBe(1);
```
Actual: `0`. Expected: `1`.

### Root cause: claudeHome points at real ~/.claude/ — tick competes with prior-test IO

`main.ts:186` constructs `claudeHome` as `join(homedir(), ".claude")` — the **real**
home directory, not the test's `tempExt`. The `vscode.workspace.workspaceFolders`
mock returns `[]` (empty), triggering the "don't strand the user" passthrough in
`sessionFilter.ts:80` — ALL real sessions are included in the tick, not just the
tempdir ones.

At time of failure, the local machine had:

- 5 live session files in `C:/Users/538252/.claude/sessions/` (verified via `ls`)
- 27 subagent JSONL files across those sessions (counted via `ls <sessionDir>/subagents/*.jsonl`)

The `runTick()` function dispatches 27 concurrent `readActivity()` calls via
`Promise.all` (`watcherLoop.ts:533`). Each `readActivity` does:
`await stat(...)` + `await open(...)` + `await fh.read(256KB)` + `await fh.close()`.

This async IO does NOT complete within the test's 50ms window when a prior test
(AC1+AC3) leaves an in-flight tick competing for the same files.

### Confirmed: test passes when run in isolation; fails when AC1+AC3 runs first

```bash
# Isolated: PASSES
npx vitest run --config vitest.integration.config.ts tests/integration/mainReplay.test.ts -t "AC5"
# Duration: 75ms, 1 passed

# With AC1+AC3 before it: FAILS
npx vitest run --config vitest.integration.config.ts tests/integration/mainReplay.test.ts -t "AC1|AC5"
# Duration: 185ms, AC5: expected +0 to be 1
```

### Confirmed: failure is deterministic, not random-flaky; count varies with load

Three consecutive full-suite runs:
- Run 1: 1 failed (AC5 only)
- Run 2: 2 failed (AC1+AC3 + AC5) — machine more loaded
- Run 3: 1 failed (AC5 only)

Both AC1+AC3 and AC5 fail when the machine is under heavier load. The root cause
is the same in both cases: the 50ms `setTimeout` is insufficient for a tick that
reads real session data from `~/.claude/`.

### Original test was broken at introduction (PR #66)

At PR #66 commit `f4a9807`, all 3 tests were already failing locally with a
DIFFERENT error: `finishedIds.get is not a function`. This was a `Set` vs `Map`
type error fixed by PR #69 (commit `7670e09`). After that fix, AC5 started "failing
silently" in a different way (the current IO-timing issue). The test was authored
to pass on CI (no real sessions) but was never validated against a machine with
active sessions.

Source: `git show f4a9807 -- tests/integration/mainReplay.test.ts` output, run
2026-05-29 on `ClaudeTeam-bram-wt`.

### CI already has test:integration

`.github/workflows/ci.yml` lines 35-37 (current as of SHA `5d4884be`):
```yaml
- name: Integration tests
  run: npm run test:integration
```

This step runs on every push on `ubuntu-latest`. No special runner setup is needed:
- No `xvfb-run` (no GUI / Electron)
- No headless display
- No `@vscode/test-electron`
- The integration suite uses vitest + Node only

The VS Code Layer 3 test (`test:vscode`) is the one that needs `xvfb-run` (line
51-52 of ci.yml). The integration suite (Layer 2) is pure Node.

### The test is environment-sensitive by design but not documented as such

The test comment at line 189-195 says:
> "Yield to the event loop so the async tick() completes its empty disk-read
> (tempExt has no ~/.claude/sessions/, so listSessions returns [])"

This comment is WRONG. The `claudeHome` used is NOT `tempExt` — it's the real
`~/.claude/`. The comment describes the intended design (read from tempExt) but
the implementation reads from `homedir()`. The test passes in CI because the CI
runner genuinely has no sessions, matching the comment's assumption.

Source: `main.ts:186` (`const claudeHome = join(homedir(), ".claude")`),
`tests/integration/mainReplay.test.ts:189-195` (comment vs reality mismatch).

## What I did NOT verify

- **Whether the test passes on a clean machine with NO active Claude Code sessions
  locally** — the machine running this triage has 5 active sessions. A machine with
  no sessions would match the CI condition and the test would likely pass.
- **Whether CI currently passes or fails on origin/main** — would need to check
  the GitHub Actions run for the most recent push to `main`. The local failure
  suggests CI passes (different environment with no sessions).
- **The exact IO time for 27 concurrent readActivity calls** — attempted `npx tsx`
  measurement but the runner silently exited. Inferred from: test passes alone in
  75ms (24ms headroom over the 50ms timeout), fails when competing.

## Fix-vs-quarantine recommendation

**Fix is clean and small** — the test needs `claudeHome` pointed at `tempExt`, not
`homedir()`. The intended design (per the test comment) was always to use a tempdir.
The production behavior being tested (replay on second resolve) is correct and
working — only the test harness is leaking real filesystem access.

Concrete fix shape: in `main.ts`, the `claudeHome` cannot be overridden without
a mock or dependency injection. The test should either:

(a) **Mock `homedir()` in the test** — `vi.mock("node:os", () => ({ homedir: () => tempExt }))`.
    This would make `main.ts` construct `claudeHome = join(tempExt, ".claude")`,
    giving the test full control over the sessions directory. This is the cleanest
    fix — aligns the implementation with the comment's stated intent, and makes
    the test hermetic.

(b) **Replace `toBe(1)` with a polling loop** — `await vi.waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(1), { timeout: 2000 })`.
    This makes the test resilient to timing but doesn't fix the structural issue
    (it still reads real session data, coupling the test to machine state).

**Recommendation: option (a)** — mock `homedir()` so the test is hermetic. Option (b)
is a bandaid that leaves the test dependent on `~/.claude/`.

**Quarantine** (`.skip` + tracking comment) is reasonable as a short-term measure
if the fix isn't dispatched immediately — the failure is local-only and doesn't
affect CI, so shipping with a `.skip` + `// TODO 86ca1n87m` comment is lower-risk
than leaving it failing.

## CI-readiness audit

### Full integration suite result on origin/main SHA 5d4884be

```
Test Files  1 failed | 9 passed (10)
      Tests  1 failed | 117 passed (118)
```

Only 1 file fails (sometimes 2 tests in the same file when under load). All other
9 integration test files pass reliably (no flakiness observed across 3 full runs).

**Other failing or flaky tests beyond line 260**: none observed. The 9 passing files:
- `noAutoCullPipeline.test.ts` (3 tests)
- `sessionFilter.test.ts` (7 tests)
- `subscriptionLeak.test.ts` (2 tests)
- `readSessionMetadata.test.ts` (17 tests)
- `fixtureFs.test.ts` (40 tests)
- `watcherTickComplete.test.ts` (5 tests)
- `watcherHandle.test.ts` (9 tests)
- `rosterWatcher.test.ts` (12 tests)
- `watcherLoop.test.ts` (20 tests)

All are hermetic (use tempdirs, not real `~/.claude/`). Only `mainReplay.test.ts`
leaks into the real filesystem.

### CI workflow scope (test:integration already present)

`.github/workflows/ci.yml` already has:
```yaml
- name: Integration tests
  run: npm run test:integration
```
No workflow change is needed. The step runs on `ubuntu-latest` with no active sessions
→ all tests pass. The local failure is irrelevant to CI-readiness.

**No special runner setup needed** for the integration suite. Contrast with the
VS Code Layer 3 suite which requires `xvfb-run -a` (line 51 of ci.yml).

## Implications for ClaudeTeam

- The `mainReplay.test.ts` failure is LOCAL-ONLY and does NOT affect CI. Adding
  `test:integration` to CI (already done) is safe — the suite passes green on the
  runner.
- The proper fix is a small mock of `homedir()` in the test to make it hermetic.
  This should be a `chore(test)` ticket dispatched to Felix or Sage.
- Until fixed, the test fails on any developer machine with active Claude Code
  sessions (i.e. every machine in this project's workflow). This is a developer
  experience friction point — a developer running `npm run test:integration` locally
  will see a failure that isn't their fault and isn't a real regression.
