# Scene-bg — manual reload checklist (`86ca3kjyk`)

Sponsor visual confirm for the full-bleed scene + scrim feature (Iris spec §FIRM;
manifest+asset PR #185, webview render+scrim PR #186). These are the checks
**jsdom cannot decide** — pixel-level appearance, floor anchoring, and the two
§FIRM feel-gates. The functional wiring (`data-scene-bg` / `--ct-scene-url`
present-when-scene, absent-on-degrade; scrim CSS gated on the right zones; kebab
content-lift exclusion) is covered headlessly by
`tests/unit/webview/sceneBg.test.ts` + `spriteManifest.test.ts` +
`buildSpriteManifest.test.ts` (75 tests) — this checklist is the visual layer
ONLY.

## Setup

1. Rebase the build worktree onto `origin/main` (admin-merge updates origin, not
   the local worktree — stale build otherwise) and rebuild: `npm run dev:install`
   (rebuild-only `npm run build` does not reinstall).
2. `Ctrl+Shift+P` → **Developer: Reload Window**.
3. Open the ClaudeTeam dashboard (Activity Bar icon). Confirm no errors in the
   Output channel within ~5s.

## Visual confirms (screenshot each)

- [ ] **Scene renders full-bleed behind the character.** The room (`room3`) fills
  the whole `.agent-tile`, edge to edge, behind the sprite — NOT confined to a
  center band. Pixel-crisp (`image-rendering: pixelated`), no blurry upscale.
- [ ] **Character grounds on the floor.** Idle pose: the standing character's
  feet land on the room's wood-floor band, not floating mid-wall. Working
  (`active_work`) pose: the baked desk + monitor sits in front of the back wall —
  **one desk, reads natural, no double-desk** (Catch 1 / 1D).
- [ ] **Name / role legible** (Zone A scrim band). The state dot + display name +
  role text read clearly over the top scrim band, not muddy over bare scene.
- [ ] **Model / activity legible** (Zone C scrim band). The model + activity text
  read clearly over the bottom scrim band. Pay attention to the **muted** text
  (activity) over the room's darker regions (bookshelf strip) — this is the
  α-sensitive case (§FIRM Q1 feel-gate below).
- [ ] **Hero zone shows the room.** The center band behind the sprite is
  UNscrimmed — the scene shows cleanly there.
- [ ] **Kebab corner-pinned on scene tiles.** Hover a scene tile → the `[⋯]`
  overflow control appears pinned **top-right**, NOT dropped into grid flow / mid-
  tile. (Source-wiring covered by the two new `sceneBg.test.ts` kebab-pin tests;
  this confirms the rendered position.) Open the menu → it pops correctly over
  the scrim, opaque.
- [ ] **Multi-agent (×N) header tile** carries the same scene + scrim + corner-
  pinned kebab. Expand the `.persona-instances` list → the expand rows sit on a
  **flat** `--ct-card-bg` surface (NO scene, NO scrim behind the compact rows).
- [ ] **Hover affordance** on a scene tile darkens the **scrim bands**, not a flat
  wash over the whole scene — the scene image itself does not change on hover.
- [ ] **Degrade to flat card.** Sprite-less / text-only tiles (e.g. a member with
  `character: null`) show today's flat `#ECEFF1` card — no scene, no scrim. (If
  testing the no-scene-asset degrade: a build with an empty `assets/sprites/scenes/`
  dir → every tile falls back to the flat card. Covered headlessly, optional to
  reproduce visually.)

## §FIRM feel-gates (sponsor decision, render-tunable — zero re-gen)

- [ ] **§FIRM Q1 — scrim opacity (`--ct-scene-scrim`, default `rgba(236,239,241,0.88)`).**
  Does the muted activity/model text stay legible over the scene's darkest band
  region? The α is the single readability lever. If muted text struggles → raise
  α toward 1.0 (bands read more as solid bars, less immersive). If the sponsor
  wants the scene fuller under the text → lower α (more scene bleed, watch
  legibility). One-token tune in `dashboard.css` `:root`.
- [ ] **§FIRM Q2 — floor anchor (`--ct-scene-anchor-y`, default `bottom`).**
  Do the feet meet the floor at the sponsor's typical panel width? If the
  character floats, the lever is `background-position` Y on the scene layer
  (`bottom` → `center 85%` etc.) — **NOT** a per-sprite vertical offset (which
  would desync idle vs desk poses). One-token tune.

Both feel-gates are confirmed at first live reload; neither blocks the build.

## Notes

- The 0.88α contrast over `room3`'s darkest region was NOT re-measured with a
  contrast tool at spec time (§FIRM.6 flagged it `Speculative`) — the visual
  legibility check above is the gate for it.
- Theme: scene + scrim are hardcoded light in both VS Code themes by design
  (card is intentionally light per dashboard.css) — no dark/light remap to check.
