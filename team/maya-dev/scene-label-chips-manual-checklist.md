# Scene-bg PER-LABEL CHIPS — manual reload checklist (`86ca3kyzq`)

Sponsor visual confirm for the per-label chip readability treatment that
SUPERSEDES the §FIRM zone-bands (sponsor decision 2026-06-03: on the shipped
#186 build name/time/model+agents/status text was hard to read over the busy
room; bands weren't enough). These are the checks **jsdom cannot decide** —
pixel-level chip appearance, opacity/contrast feel, and the chip-vs-scene
balance. The functional wiring (`data-scene-bg` / `--ct-scene-url`; the
`ct-scene-chip` marker class present-per-label-when-scene, absent-on-degrade;
chip CSS gated; bands removed; kebab content-lift exclusion) is covered
headlessly by `tests/unit/webview/sceneBg.test.ts` (16 tests) — this checklist
is the visual layer ONLY.

## Setup

1. Rebase the build worktree onto `origin/main` (admin-merge updates origin, not
   the local worktree — stale build otherwise) and rebuild: `npm run dev:install`
   (rebuild-only `npm run build` does not reinstall).
2. `Ctrl+Shift+P` → **Developer: Reload Window**.
3. Open the ClaudeTeam dashboard (Activity Bar icon). Confirm no errors in the
   Output channel within ~5s.

## Visual confirms (screenshot each)

- [ ] **Every label sits on its own chip.** Name, role, model, and
  status/freshness each ride a small rounded semi-transparent backing sized to
  the text (NOT a full-width band). The scene shows between chips.
- [ ] **Name chip legible** over any part of the room (incl. over the dark
  bookshelf strip and the pale window).
- [ ] **Status / freshness chip legible** — pay attention to the muted activity
  text over the room's darker regions (the α-sensitive case; feel-gate below).
- [ ] **Model + (N agents) chips legible** in Zone C.
- [ ] **×N agent-count badge chipped** on multi-agent tiles — the count reads
  over the room; hover still works (badge hover composes with the chip-hover).
- [ ] **Hero/character area is CLEAR of chips.** No chip backing behind the
  sprite — the character + scene read clean in Zone B.
- [ ] **No double-up scrim.** The two full-width §FIRM bands are GONE — only the
  per-label chips provide contrast (verify the meta rows no longer have a
  continuous band behind the whole row).
- [ ] **Kebab corner-pinned on scene tiles.** Hover a scene tile → `[⋯]` pinned
  top-right, not in grid flow. Menu pops opaque.
- [ ] **Multi-agent (×N) header tile** carries chips on name/role/model/status +
  the ×N badge + the (N agents) hint. Expand `.persona-instances` → the rows sit
  on a **flat** `--ct-card-bg` surface (NO scene, NO chips behind compact rows).
- [ ] **Hover affordance** darkens the **chips** (`--ct-scene-chip-hover`), not a
  flat wash over the scene — the scene image itself does not change on hover.
- [ ] **Degrade to flat card.** Sprite-less / text-only tiles show today's flat
  `#ECEFF1` card — no scene, no chips.

## Feel-gate (sponsor decision, render-tunable — zero re-gen)

- [ ] **Chip opacity (`--ct-scene-chip`, default `rgba(236,239,241,0.92)`).** Do
  the chips read over the scene's darkest band region while still letting the
  scene breathe between them? The α is the single readability lever. Muted text
  struggling → raise α toward 1.0 (chips read more solid). Want fuller scene
  bleed under the text → lower α (watch legibility). One-token tune in
  `dashboard.css` `:root`. The hover chip token (`--ct-scene-chip-hover`,
  `rgba(225,228,230,0.94)`) tracks it.
- [ ] **Floor anchor (`--ct-scene-anchor-y`, default `bottom`)** — carried over
  from #186, unchanged. Feet meet the floor at the sponsor's typical panel
  width; tune `background-position` Y on the scene layer if floating.

## Notes

- The 0.92α chip contrast over `room3`'s darkest region was NOT re-measured with
  a contrast tool — the visual legibility check above is the gate (chips are
  slightly fuller than the old 0.88 band α precisely because they're small).
- Theme: scene + chips are hardcoded light in both VS Code themes by design
  (card is intentionally light per dashboard.css) — no dark/light remap to check.
