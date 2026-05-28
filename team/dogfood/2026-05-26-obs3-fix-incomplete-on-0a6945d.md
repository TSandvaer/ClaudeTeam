# Dogfood — Obs 3 fix appears incomplete on `0a6945d` (2026-05-26)

Follow-up verification after PR #66 ("fix(host): replay last-known state to remounted webview") shipped. Sponsor installed a fresh vsix built from `0a6945d` and exercised the Obs 3 close+reopen path. The empty-state still persists — the fix as shipped does not eliminate the failure mode it targeted.

## Context

- Sponsor: Thomas
- Install commit: `0a6945d` (origin/main tip, verified `git -C c:/Trunk/PRIVATE/ClaudeTeam rev-parse HEAD` → `0a6945d4b4f9b56236aacf68da8ad942b599104e`)
- Install command (chained): `git pull --ff-only origin main && npm run build && npx vsce package --no-yarn && code --install-extension claudeteam-0.0.1.vsix --force`
- Build artifacts (verified from `npm run build` output): `dist/extension/main.cjs (674.0kb)`, `dist/webview/main.js (35.6kb)`, `dist/webview/dashboard.css (12.7kb)`
- Host: Windows 11 Enterprise, VS Code (workspace = `c:\Trunk\PRIVATE\ClaudeTeam`)
- VS Code window reloaded after install (`Developer: Reload Window`); new claude-vscode pid issued (33704)

## Observation

**Sequence of actions:**
1. Window reload after vsix install → dashboard renders a single session tile: `SESSION baf09ef7 [claude-vscode] pid=33704`, workspace `c:\Trunk\PRIVATE\ClaudeTeam`, no title yet. Hide-finished chip visible in header.
2. Click robot icon in Activity Bar → ClaudeTeam pane closes.
3. Click robot icon again → ClaudeTeam pane reopens.
4. **Dashboard renders "No live Claude Code sessions."** with the Hide-finished chip still visible above it.
5. Sponsor waited >30 seconds: "I see, even after waiting 30+ section" (verbatim sponsor message at observation time).
6. Empty state persists; the live session does not re-appear.

**Ground-truth verification (orchestrator-side, immediately after the failed reopen):**
- Sessions directory listing (Glob `C:/Users/538252/.claude/sessions/*.json`) returned two files: `35508.json`, `33704.json`. The PID `33704` matches the session tile that rendered before the close+reopen.
- The session JSONL `33704.json` exists on disk and is the correct file for the live session.

## Expected behavior (per PR #66 intent)

PR #66 commit message: `fix(host): replay last-known state to remounted webview (86c9yxv6d) (#66)`. Per `team/bram-research/86c9yteju-triage-2026-05-26.md` Observation 3 classification ("defect: host does NOT push current state on webview re-resolve"), the fix should send the host's most recent rendered state to the new webview on `provider.onResolved()`. After replay, the session tile that was just visible should re-appear immediately without waiting for the next watcher tick.

## Actual behavior

Empty state ("No live Claude Code sessions.") persists for >30 seconds after pane close+reopen on the live vsix from `0a6945d`. The Hide-finished chip continues to render correctly, indicating the host-to-webview message channel is functional and at least some host state is being sent — but the session-list payload is not surfacing.

## Hypotheses (label per never-fabricate — none patch-confirmed; Bram to verify/refute)

Three candidates, in order of plausibility based on the symptom shape:

1. **Predicted symptom (verify before patching): replay sends an empty `sessions: []` payload.** If the host's cached state was reset on webview disposal (or never accumulated past the initial empty bootstrap), the replay would deliver an empty list, overwriting the new webview's blank slate with… another blank slate. Visible behavior would match: empty state persists.

2. **Predicted symptom (verify before patching): replay payload is sent before the webview's message handler is wired.** If `onResolved` fires the replay before the webview has subscribed to the message bus, the message is dropped silently. Subsequent watcher ticks (which would push fresh state) might also be missing if the tick doesn't fire while the pane is open with no state change.

3. **Speculative — no source yet: PR #66 replays a different state shape than the webview's current render path expects.** If the replay sends a partial state object (e.g., only the hide-finished flag, omitting the sessions list), the webview's render would treat the missing field as empty.

## Repro

1. From a clean ClaudeTeam workspace with a live CC session active, install the vsix from `0a6945d` (or origin/main if ahead): `npm run build && npx vsce package --no-yarn && code --install-extension claudeteam-0.0.1.vsix --force`.
2. Reload window. Confirm the session tile renders.
3. Click robot icon in Activity Bar to close the ClaudeTeam pane.
4. Click robot icon again to reopen.
5. Observe persistent "No live Claude Code sessions." despite the session JSONL existing on disk.

## Out of scope for this observation

- Hide-finished chip behavior is functioning correctly (renders post-remount). Not a regression surface.
- Window-reload path is functioning correctly (session tile appears immediately). Only the pane close+reopen path is broken.
- Obs 6a/6b/hide-finished toggle verification — blocked on this observation since the dashboard can't render the surfaces under test.

## Pointer

ClickUp ticket: filed under post-V1 dogfood backlog (ticket ID appended once created).

Related: original Obs 3 ticket `86c9yxv6d` (complete, PR #66 merged at `f4a9807`). This observation is the dogfood-verify finding that PR #66's fix is incomplete.
