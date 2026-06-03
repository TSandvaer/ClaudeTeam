# Manual reload checklist — active_work POOL (ticket 86ca3mge9, PR #190)

Sponsor-side VISUAL confirm. Pool cycling + recolor + grounding are pixel-fidelity
questions jsdom cannot answer (per `.claude/docs/testing-strategy.md` § Layer
decision rule); everything FUNCTIONAL is already covered by the Layer-1 +
Layer-2.5 tests below — this checklist is only the visual gate.

## Install the fresh build first

`npm run build` does NOT reinstall the running extension — use `npm run dev:install`
(per `.claude/docs/vscode-extension-conventions.md` § Install workflow). Verify the
running bundle is fresh before judging behavior, or a stale install will mask the
change.

```
git -C c:/Trunk/PRIVATE/ClaudeTeam pull --ff-only origin main
git -C c:/Trunk/PRIVATE/ClaudeTeam rev-parse HEAD   # confirm the merge SHA
cd c:/Trunk/PRIVATE/ClaudeTeam
npm run dev:install
```

Then `Ctrl+Shift+P` → "Developer: Reload Window" → open the ClaudeTeam dashboard.

## Pool cycling (the headline change)

- [ ] A running tile (agent doing tool != Read — Edit / Bash / Write etc.) plays
      a working desk pose, NOT the old single `active_work` pose every time.
- [ ] Over SUCCESSIVE active episodes (let an agent go idle, then become active
      again — or watch several running tiles), the working pose VARIES across the
      three: **typing**, **work_cycle** (working_cycle), **work_focus**
      (working_focused). All three should be reachable; it is random per episode.
- [ ] WITHIN one active episode the pose stays STABLE — it does NOT flip between
      the three on each ~2s poll tick. (One pick per episode; loops until idle.)
- [ ] On a fresh active episode (the tile went idle → active again) the pose may
      change to a different pool member — a re-roll is expected here.

## Read pose (must stay on the OLD desk — OOS, do NOT flag)

- [ ] A running tile whose current tool IS Read shows the `active_read` pose
      (the old `sitting_at_a_desk_fa` desk). This visibly DIFFERS from the new
      mouse-desk working poses — that mismatch is Maya's flagged follow-up
      (active_read re-gen), explicitly out of scope. Do NOT report it as a bug.
- [ ] Toggling Read ↔ work on one agent: read shows the old desk, work shows a
      mouse-desk pool pose. The work pose after a read should be freshly picked.

## Visual fidelity per working pose (typing / work_cycle / work_focus, both chars)

For F01 (maya / iris / nora / sage tiles) AND M01 (felix / bram tiles):

- [ ] **Mouse hand:** the mouse is at the character's RIGHT hand =
      viewer's-LEFT side of the sprite. (Confirm it is not mirrored.)
- [ ] **Desk colour:** the desk reads WOOD (warm brown). No PINK desk residue
      anywhere (the PINK→WOOD recolor must be complete).
- [ ] **Trousers / lower body:** correct dark colour per character — NOT brown.
      (The DARK shirt/trouser recolor box; F01 vs M01 differ but neither is the
      wood brown.)
- [ ] **Legs planted:** legs/feet are grounded at the desk, not floating — the
      pose sits correctly at the mouse desk.
- [ ] **Transparent background:** the character sits on the scene-bg layer (room),
      not on a baked-in second desk. No double-furniture / perspective clash.

## Degrade (must be unchanged)

- [ ] A text-only tile (member with no sprite binding, or `character: null`,
      or a no-folder / browser-dev window with no sprite base URI) renders as a
      FLAT card — no sprite box, no broken image, text rows intact.

## Theme

- [ ] Toggle dark ↔ light theme: sprite frames render in the existing
      `.sprite-box` chrome with no broken styling. (No CSS changed in this PR;
      low risk — a quick glance suffices.)

---

### What is already proven headlessly (no need to re-verify by eye)

These are FUNCTIONAL, deterministic, and covered by tests — listed so the sponsor
knows the manual pass is purely visual:

- One pick per active episode + stickiness across the poll re-render —
  `tests/unit/webview/spritePlayer.test.ts` (sticky / re-roll describe block) +
  `tests/unit/webview/spriteTile.test.ts` (END-TO-END through the tile + tracker).
- Re-roll only on idle→active; read→work re-rolls; work→read resolves
  `active_read` — `spriteTile.test.ts` active-pool END-TO-END block.
- `active_read` never pool-drawn; no-pool char falls back to `active_work` —
  `posePicker.test.ts` + `spritePlayer.test.ts`.
- Pool membership invariant (only typing / work_cycle / work_focus drawn) —
  `posePicker.test.ts` + `spritePlayer.test.ts`.
- Flat-card degrade — `spriteTile.test.ts` AC5 graceful-degrade block.
