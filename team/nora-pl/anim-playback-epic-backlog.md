# EPIC: Per-Character / Per-Animation Playback Tweaks (experimental, solo-user)

**Author:** Nora (PL) · **Date:** 2026-05-31 · **Branch:** `nora/anim-playback-epic-backlog`
**Source:** Sponsor request 2026-05-31 (three asks) + Bram feasibility note `team/bram-research/anim-playback-tweak-feasibility-2026-05-31.md` (branch `bram/anim-playback-research`).
**Status:** Dispatch-ready, pending orchestrator/sponsor review.

> **Scope flag — solo-user / experimental.** This feature is for the sponsor as the ONLY user. NOT Marketplace-bound, NOT subject to the external-user UX bar. The tweak surface is sponsor-hand-edited `animations.json` fields + rebuild + reload (a power-user workflow), not a polished panel. The live tuner (E5) is a quality-of-life aid for the sponsor, not a shipped end-user feature.

---

## Technical ground truth (re-verified against this branch's working tree)

Bram's feasibility note is **accurate on file, symbols, mechanisms, AND line numbers** — his "line 368" hard-wrap and `PLAYBACK_OVERRIDES` "157-174" both match this branch. I re-verified every reference below by `grep`/Read against `src/webview/sprites/spritePlayer.ts` (397 lines) on this branch. **Implementers: these refs are confirmed; trust them.**

| Concept | Verified location | Note |
|---------|-------------------|------|
| `FRAME_MS_DEFAULT = 160` | `:58` | default per-frame ms |
| `DWELL_MS_DEFAULT = 400` | `:60` | fixed final-frame hold (global constant, not per-anim) |
| `PEAK_DWELL_MS_DEFAULT = 600` | `:64` | default mid-anim peak-frame hold |
| `PlaybackOverride` interface | `:70-84` | fields today: `speedMultiplier?`, `dwellFrameIndex?`, `dwellMs?` — NO `playbackMode`, NO `finalDwellMs` |
| `PLAYBACK_OVERRIDES` map | `:157-174` | **populated** (86ca1fntp tuning): M01 + F01 tables, 0.5×/0.7× speed lists + peak `dwellFrameIndex` for coffee/snack/phone/stretch |
| `resolvePlayback(characterName, animName, table?)` | `:181-187` | pure lookup of the override table (default arg = `PLAYBACK_OVERRIDES`); returns `{}` for unlisted |
| `createSpriteBox` (engine factory) | `:254` | builds the sprite box + starts the loop |
| override resolved in factory | `:332` | `const override = resolvePlayback(char.character, canonicalName)` |
| speed application | `:333-338` | `frameMs = FRAME_MS_DEFAULT / speedMultiplier` |
| `tick()` loop | `:353-370` | the sole sequencer; `setTimeout`-driven |
| final-frame dwell | `:360-362` | `if (frameIdx === lastIndex && !isActive) ms += DWELL_MS_DEFAULT` — fixed constant, NOT per-anim tunable |
| peak-frame dwell | `:365-367` | `if (peakIsValid && frameIdx === peakIndex) ms += peakDwellMs` |
| **the hard-wrap (pingpong gap)** | **`:368`** | `frameIdx = frameIdx === lastIndex ? 0 : frameIdx + 1;` — always +1, wraps to 0, no reverse |
| consumers | `agentTile.ts:272`, `multiAgentPersonaTile.ts:270` | both call `createSpriteBox` |

**animations.json** (`assets/sprites/ClaudeTeam-M01-Dev/animations.json` + `…-F01-Dev/…`): the `animations` field is a `name → folder` STRING map; the files carry NO playback fields (speed/dwell/mode) and are consumed only at BUILD time by `scripts/build-sprite-manifest.mjs`, which emits `src/webview/sprites/generatedManifest.ts` (frame-URI arrays). **The webview runtime never reads `animations.json` directly — it reads the generated TS manifest baked into the bundle.** Per-frame timing today lives entirely in `spritePlayer.ts`.

**Plumbing consequence (load-bearing for E2):** the sponsor's chosen surface — "edit `animations.json` + reload" — does NOT work today and is NOT a zero-rebuild path. Making the three fields live-editable from `animations.json` requires ALL of: (a) extend the json schema to carry playback fields, (b) make `build-sprite-manifest.mjs` thread them into `generatedManifest.ts`, (c) make `spritePlayer.ts` read them from the manifest (via `resolvePlayback`) instead of the hardcoded `PLAYBACK_OVERRIDES` map. After the rebuild the manifest TS regenerates, so "reload" still means "rebuild + reload" (the manifest is a compiled TS module). E2 scopes this explicitly; per Bram's Surface-A analysis it is M-sized, not trivial.

---

## Sponsor's three asks (mapped to verified reality)

1. **Per-animation speed** — mechanism + per-char tuning EXIST (`speedMultiplier` in `PlaybackOverride` `:70-84`, applied at `:333-338`; populated in `PLAYBACK_OVERRIDES` `:157-174`). But values live in the hardcoded map and require a rebuild. To satisfy the sponsor's "edit animations.json" surface, speed must be routed through the json→manifest path (E2). The ENGINE work for speed is done; the SURFACE work is E2.
2. **Slow + hold-then-restart (final-frame dwell)** — partially exists. `DWELL_MS_DEFAULT` (`:60`, applied `:360-362`) holds the final frame, but it is a fixed global constant — there is NO per-anim `finalDwellMs` override. GAP = add `finalDwellMs?` to `PlaybackOverride` and read it at `:360-362`. Size S. → E1.
3. **Ping-pong / reverse playback** — does NOT exist. The hard-wrap at `:368` always advances +1 and wraps to 0. GAP = add `playbackMode:"loop"|"pingpong"` + a `direction` var, replace the wrap. Reuses frames reversed; NO new PixelLab. Size S-M. → E1.

---

## Locked decisions (do NOT re-open)

1. **Tweak surface = `animations.json` fields + rebuild + reload.** Three optional per-animation fields. No panel initially.
2. **Anti-tedium = pose-keyed defaults cascade + live slider tuner.** `pose-defaults.json` sets e.g. `idle_stretch = pingpong + hold` ONCE for all chars; per-char `animations.json` overrides only exceptions. Tuner = live-preview sliders that auto-save to `animations.json`.
3. **Resolution order (cascade):** per-char `animations.json` field > pose-keyed default > engine default. Field-level merge.
4. **No new PixelLab.** Pingpong reuses existing frames in reverse.
5. **Tuner UI = Iris spec FIRST, then Maya impl.** Do not design the tuner UI in an engine ticket.
6. **Pingpong endpoint behavior is a sponsor-preview gate, not a silent choice** (see Design Call).

---

## LOCKED Vocabulary contract (Pattern B — every parallel dev reads identical names)

Names match the REAL engine (`spritePlayer.ts`). Any ticket touching the new playback concept MUST use these exact identifiers. Divergence is mergeability-blocking → REQUEST_CHANGES in cross-review, never APPROVE_WITH_NITS.

| Item | Locked value |
|------|--------------|
| Override type to EXTEND | `PlaybackOverride` (existing, `spritePlayer.ts:70-84`) — extend, do NOT introduce a parallel type |
| Resolver | `resolvePlayback(characterName, animName, table?)` (existing, `:181-187`) — extend to read the cascade |
| Field — speed (exists) | `speedMultiplier?: number` (reuse; default `1`) |
| Field — final-frame hold (NEW) | **`finalDwellMs?: number`** (chosen over `holdMs` for sibling consistency with existing `dwellMs`; absent = current fixed `DWELL_MS_DEFAULT` behavior — see E1 AC) |
| Field — playback mode (NEW) | `playbackMode?: PlaybackMode` |
| Playback-mode type (NEW) | `type PlaybackMode = "loop" \| "pingpong";` exported from `spritePlayer.ts`; default `"loop"` |
| Discriminator literals | exact lowercase `"loop"` and `"pingpong"` |
| Pose-defaults file (NEW) | **`pose-defaults.json`** at `assets/sprites/pose-defaults.json` (read by the build script alongside the per-character `animations.json`) |
| Pose-defaults shape | `{ "<animationName>": { speedMultiplier?, finalDwellMs?, playbackMode? }, ... }` keyed by animation name |

**Nora resolutions of Bram's open questions** (within locked-decision scope — no sponsor round needed):
- Field name: **`finalDwellMs`** (not `holdMs`) — sibling consistency with `dwellMs`.
- `pose-defaults.json` location: **`assets/sprites/pose-defaults.json`** — same dir the build script already walks for the per-character folders.
- Reload mechanism: **rebuild + reload for E1-E3** (sponsor runs the build, reloads webview). Live auto-save/watch is the tuner's job (E5). Engine work stays decoupled from a file-watcher.

---

## Dispatch order (Pattern A — shared type lands FIRST)

```
E1 (engine: finalDwellMs + playbackMode:pingpong in spritePlayer.ts) ── owns PlaybackMode + the two new fields on PlaybackOverride. MERGE FIRST.
        │
        ▼
E2 (animations.json schema + build-script threading + resolvePlayback reads manifest) ── depends on E1's type; makes the 3 fields live-editable. M-sized plumbing.
        │
        ▼
E3 (pose-keyed defaults cascade — pose-defaults.json) ── depends on E2's read path.
        │
        ▼
E4 (Iris tuner-UI SPEC) ── safe to run PARALLEL with E1-E3 (spec, no code dep); gates E5.
        │
        ▼
E5 (Maya tuner-UI impl + Sage QA) ── depends on E3 cascade + E4 spec.
```

Rationale: E1 introduces `PlaybackMode` + the two new fields on `PlaybackOverride`. Sequencing it first (Pattern A) means E2/E3 build against merged-on-main vocabulary — no parallel divergence. E4 (spec only) is the lone safe parallel with E1.

---

## Design call to surface to sponsor (the ONE preview gate)

**Pingpong endpoint behavior.** Naive pingpong advances `+1` to the last frame, then `-1` back to the first, then repeats. Bram's note (§Feature 3 gotcha) flags that frame `0` and frame `N-1` get displayed twice per cycle at the turnaround (the direction reverses ON them). For raise/lower-arms poses (e.g. `idle_stretch`) this usually looks BETTER (slight hold at apex + at rest). But whether to (a) hold on endpoints (naive) or (b) skip endpoints on the turn (`0,1,…,N-1,N-2,…,1,0,1,…`) is a **feel decision**. Bram also flags a **dwell interaction**: the existing final-frame `DWELL_MS_DEFAULT` (`:360-362`) fires at `frameIdx === lastIndex`, which in pingpong is the apex turnaround — likely desirable, but E1 must gate it deliberately (apply only on the forward arrival at `lastIndex`).

→ **E1 AC requires:** ship naive endpoint-hold pingpong as the default, but the PR Self-Test Report MUST include a webview screenshot/gif of `idle_stretch` pingpong so the sponsor eyeballs the feel before merge. Skip-endpoints is a one-line follow-up NIT if preferred. **Do NOT silently pick — make it a sponsor-visible preview.**

---

# Child tickets

---

## E1 — feat(webview): playback engine — `finalDwellMs` + `playbackMode:"pingpong"` in spritePlayer

- **Source:** Sponsor asks 2 + 3; Bram note §Feature 2 / §Feature 3 (mechanism), verified locations above.
- **Owner:** Felix (or Maya — webview-capable). **Reviewer:** the other of Felix/Maya. **Sage** QA.
- **Size:** S-M. **Priority:** high (foundation — owns the vocabulary).
- **Scope:**
  1. Extend `PlaybackOverride` (`spritePlayer.ts:70-84`) with `finalDwellMs?: number` and `playbackMode?: PlaybackMode`.
  2. Add + export `type PlaybackMode = "loop" | "pingpong";`.
  3. **`finalDwellMs`:** at the final-frame dwell (`:360-362`), use `override.finalDwellMs ?? DWELL_MS_DEFAULT` so an absent field preserves today's fixed-400ms behavior and a set value tunes it per-anim. Resolve the value in the factory near `:332-341` alongside `speedMultiplier`/`peakDwellMs`.
  4. **`playbackMode:"pingpong"`:** replace the hard-wrap at `:368` with a direction-aware advance — a `direction` var (+1/-1) that flips at the endpoints. `"loop"` (default/absent) keeps current behavior byte-identical. Per Bram's gotcha, gate the final-frame dwell to fire only on the FORWARD arrival at `lastIndex` (not on the return pass).
  5. Endpoint behavior = naive endpoint-hold (default per Design Call); Self-Test Report includes the `idle_stretch` pingpong gif for sponsor feel-check.
- **Acceptance criteria:**
  - AC1: `PlaybackMode` union + the two new optional fields exist on `PlaybackOverride`, exported.
  - AC2: With `finalDwellMs: 800` on an anim's override, the player holds ~800ms on the final frame before restarting; absent → identical to today (`DWELL_MS_DEFAULT` = 400).
  - AC3: With `playbackMode:"pingpong"`, playback runs forward to last frame then reverses to first then repeats; `"loop"`/absent → byte-identical to today (`:368` behavior preserved).
  - AC4: `speedMultiplier` and `dwellFrameIndex`/`dwellMs` continue to apply unchanged (no regression at `:333-367`).
  - AC5: Self-Test Report (webview-smoke gate) includes a manual reload confirmation AND an `idle_stretch` pingpong screenshot/gif.
- **Out-of-scope:** routing fields from `animations.json` (E2 — E1 still reads the hardcoded `PLAYBACK_OVERRIDES` map, just with the new fields supported on the type); pose-defaults cascade (E3); tuner UI (E4/E5); new PixelLab; first-frame hold (already reachable via `dwellFrameIndex: 0` per Bram — no new code).
- **Done-when test:** unit tests for the pingpong direction sequence (frames `[a,b,c]` pingpong → index order `0,1,2,1,0,1,2,…`) + a `finalDwellMs` timing assertion. The `tests/unit/webview/spritePlayer.test.ts` deterministic scheduler harness supports stepping — reuse it. Green CI; Sage sign-off; webview-smoke Self-Test Report with the pingpong gif.
- **Files-in-play:** `src/webview/sprites/spritePlayer.ts` (type `:70-84`; factory resolve `:332-341`; `tick` `:353-370`; final dwell `:360-362`; wrap `:368`); `tests/unit/webview/spritePlayer.test.ts`.
- **Cross-refs:** Vocabulary contract; Bram note §Feature 2/§Feature 3.

### Dispatch-contract (E1)
- **Vocabulary:** `PlaybackMode = "loop" | "pingpong"`; fields `finalDwellMs?`, `playbackMode?` on existing `PlaybackOverride` (`:70-84`); resolver stays `resolvePlayback`. Defaults `"loop"` / `DWELL_MS_DEFAULT` / `1`.
- **State-shape contract:** E1 owns the type. E2/E3 import `PlaybackOverride` + `PlaybackMode` from `spritePlayer.ts`. No parallel type.
- **Final-report contract:** ≤200 words; PR URL + verdict + blockers + doc-updates; CI claim cites run-id URL; webview-smoke claim cites the screenshot.

---

## E2 — feat(host+build): `animations.json` playback schema + build-script threading + manifest read-routing

- **Source:** Sponsor surface decision (animations.json + reload); Bram note §Surface (A) + §"What I did NOT verify" (the json→manifest threading).
- **Owner:** Felix (build + manifest path). **Reviewer:** Maya. **Sage** QA.
- **Size:** M (Bram's note calls the json→manifest→runtime path M-sized; NOT a trivial pass-through — `animations.json` carries no playback fields today and the runtime reads only `generatedManifest.ts`).
- **Scope:**
  1. Decide + implement a playback-field schema in `animations.json` (per-anim `{ speedMultiplier?, finalDwellMs?, playbackMode? }`). The current `animations` map is `name→folder` strings, so the schema needs a separate playback block OR a richer per-anim object — Felix picks the cleaner shape and documents it.
  2. **Build-script threading:** `scripts/build-sprite-manifest.mjs` reads the playback fields and emits them into `src/webview/sprites/generatedManifest.ts` per anim.
  3. **Read-routing:** change `resolvePlayback` (`spritePlayer.ts:181-187`) so the per-anim playback fields come from the generated manifest entry instead of the hardcoded `PLAYBACK_OVERRIDES` map. Migrate the existing M01/F01 entries (`:157-174`) into the json, then remove the hardcoded map.
  4. Validation: malformed field values (e.g. `playbackMode:"bounce"`) fall back to engine default without crashing (log a warning).
- **Acceptance criteria:**
  - AC1: Adding `speedMultiplier`/`finalDwellMs`/`playbackMode` to an anim in `animations.json` + `npm run build` + reload drives E1's engine behavior; no TS edit required.
  - AC2: `generatedManifest.ts` carries the playback fields after build (verify the emit).
  - AC3: `resolvePlayback` reads from the manifest; the pre-existing M01/F01 overrides migrated with no visual regression; `PLAYBACK_OVERRIDES` hardcoded map removed.
  - AC4: Unknown `playbackMode` value falls back to `"loop"` with a console warning; no crash.
  - AC5: PR documents the exact json schema chosen + the build-script change.
- **Out-of-scope:** pose-defaults cascade (E3); file-watcher/auto-reload (tuner E5); tuner UI; engine field semantics (E1 owns those).
- **Done-when test:** unit test that `resolvePlayback` returns manifest-fed fields; a build-emit assertion (manifest contains the fields); migration regression test (the M01/F01 overrides resolve to their prior values); webview-smoke Self-Test Report (edit json → `npm run build` → reload → observe). Green CI + Sage sign-off.
- **Files-in-play:** `assets/sprites/ClaudeTeam-{M01,F01}-Dev/animations.json` (schema + migrated values); `scripts/build-sprite-manifest.mjs` (thread fields); `src/webview/sprites/generatedManifest.ts` (regenerated); `src/webview/sprites/spritePlayer.ts` (`resolvePlayback` `:181-187` + remove map `:157-174`).
- **Cross-refs:** depends on E1 merged (imports `PlaybackOverride`/`PlaybackMode`); Vocabulary contract.

### Dispatch-contract (E2)
- **Depends on:** E1 merged to main (type vocabulary).
- **Vocabulary:** import `PlaybackOverride`, `PlaybackMode` from `spritePlayer.ts`. Pose-defaults NOT in this ticket.
- **Final-report contract:** ≤200 words; cite the build+reload smoke evidence (screenshot) + CI run-id.

---

## E3 — feat(build): pose-keyed defaults cascade (`pose-defaults.json`)

- **Source:** Sponsor anti-tedium decision.
- **Owner:** Felix. **Reviewer:** Maya. **Sage** QA.
- **Size:** M. **Priority:** medium (depends on E2).
- **Scope:**
  1. Add `assets/sprites/pose-defaults.json` keyed by animation name: `{ "<anim>": { speedMultiplier?, finalDwellMs?, playbackMode? } }`.
  2. `scripts/build-sprite-manifest.mjs` reads `pose-defaults.json` from the sprites dir and exposes it to `resolvePlayback` (e.g. emit a pose-defaults table into `generatedManifest.ts`).
  3. **Resolution order in `resolvePlayback` (`:181-187`):** per-char `animations.json` field > pose-keyed default for that anim name > engine default. **Field-level merge** (a per-char entry setting only `speedMultiplier` still inherits `playbackMode`/`finalDwellMs` from the pose default).
  4. Ship `pose-defaults.json` as empty `{}` (behavior unchanged) unless the sponsor provides seed values.
- **Acceptance criteria:**
  - AC1: `idle_stretch: { playbackMode:"pingpong", finalDwellMs:800 }` in `pose-defaults.json` applies to ALL characters' `idle_stretch` without per-char edits.
  - AC2: A per-char `animations.json` entry setting only `speedMultiplier` for `idle_stretch` overrides ONLY speed, inheriting `playbackMode`/`finalDwellMs` from the pose default (field-level merge, not whole-object replace).
  - AC3: Empty/absent `pose-defaults.json` → behavior identical to E2 end-state (no regression).
  - AC4: 3-layer field-level precedence verified by unit test.
- **Out-of-scope:** tuner UI (E4/E5); auto-reload; fields beyond the three.
- **Done-when test:** unit tests for the 3-layer field-level merge; webview-smoke (populate pose-defaults → `npm run build` → reload → all chars' idle_stretch pingpong). Green CI + Sage sign-off.
- **Files-in-play:** `assets/sprites/pose-defaults.json` (new); `scripts/build-sprite-manifest.mjs`; `src/webview/sprites/spritePlayer.ts` (`resolvePlayback` cascade `:181-187`); `src/webview/sprites/generatedManifest.ts` (regenerated).
- **Cross-refs:** depends on E2 merged; Vocabulary contract.

### Dispatch-contract (E3)
- **Depends on:** E2 merged.
- **Vocabulary:** `pose-defaults.json` @ `assets/sprites/pose-defaults.json`; cascade `per-char > pose-default > engine default`, FIELD-LEVEL merge.
- **Final-report contract:** ≤200 words; cite cascade unit-test run + smoke screenshot.

---

## E4 — design(spec): live playback tuner UI spec (Iris)

- **Source:** Sponsor anti-tedium decision (live slider tuner).
- **Owner:** Iris (design spec). **Reviewer:** Maya (visual) / Felix (spec edges). NOT Sage (no code yet).
- **Size:** M. **Priority:** medium (parallel with E1-E3; gates E5).
- **Scope:** Author the UX spec for a live tuner view: speed slider, hold (`finalDwellMs`) slider, playback-mode dropdown (`loop`/`pingpong`), live preview of the selected char+animation (reuse `createSpriteBox`), and auto-save-back to the correct file (`animations.json` per-char vs `pose-defaults.json`). Cover: where it lives (panel vs standalone view), char+animation selection, the write-target rule (per-char vs pose-default and how the sponsor chooses), debounce/save semantics, preview surface. **No code.** Reconcile against any tuner work on the `maya/86ca1fntp-playback-tuning` branch (the PR that populated `PLAYBACK_OVERRIDES`).
- **Acceptance criteria:**
  - AC1: Spec enumerates every control + its bound field using the LOCKED vocabulary (`speedMultiplier`/`finalDwellMs`/`playbackMode`).
  - AC2: Spec defines the write-target rule (per-char `animations.json` vs `pose-defaults.json`).
  - AC3: Spec defines the live-preview mechanism (`createSpriteBox`) + save/debounce semantics.
  - AC4: Detailed enough that Maya can implement E5 with zero clarifying round.
- **Out-of-scope:** implementation; engine changes; pixel-polish (solo-user experimental — functional spec over polish).
- **Done-when test:** spec doc merged; orchestrator confirms it satisfies the E5 dispatch-readiness bar.
- **Files-in-play:** `team/iris-design/anim-tuner-spec.md` (or the existing iris tuner spec path).
- **Cross-refs:** Vocabulary contract; gates E5.

---

## E5 — feat(webview): live playback tuner implementation + QA (Maya + Sage)

- **Source:** E4 spec.
- **Owner:** Maya. **Reviewer:** Felix. **Sage** QA (functional, headless where possible).
- **Size:** L. **Priority:** medium (last — depends on E3 + E4).
- **Scope:** Implement the tuner per Iris's E4 spec. Live sliders/dropdown, live preview via `createSpriteBox`, auto-save to the correct json file per the spec's write-target rule (extension-host writes the json — crosses webview↔host, so webview-smoke gate applies). Functional behavior (does a slider change persist to json? does preview update live? does the write target the right file?) MUST be headlessly testable (jsdom DOM-interaction) per the functional-vs-visual scope correction — do NOT defer functional checks to the sponsor.
- **Acceptance criteria:**
  - AC1: All E4-spec controls render and are wired.
  - AC2: Adjusting a slider updates the live preview within the spec's debounce window.
  - AC3: A tweak persists to the correct json file (per-char vs pose-default) per the spec rule — verified by a jsdom interaction test asserting the write payload + target.
  - AC4: Reload reflects the saved values (round-trip).
  - AC5: Webview-smoke Self-Test Report + jsdom DOM-interaction test for the save/preview path.
- **Out-of-scope:** engine semantics (E1); schema/plumbing (E2); cascade (E3) — consumes them.
- **Done-when test:** jsdom interaction tests (slider→preview, slider→correct-json-write); webview-smoke Self-Test Report; green CI; Sage sign-off. Visual feel = sponsor post-merge; FUNCTIONAL save/preview = tested pre-merge.
- **Files-in-play:** TBD by E4 spec (tuner view component + its test); host message-passing path for the file write.
- **Cross-refs:** depends on E3 + E4 merged; Vocabulary contract.

### Dispatch-contract (E5)
- **Depends on:** E3 merged + E4 spec merged.
- **Functional-testing note:** save/preview/write-target are functional → jsdom-testable → NOT sponsor-deferred. Only visual feel is sponsor post-merge.
- **Final-report contract:** ≤200 words; cite jsdom interaction-test run + webview-smoke screenshot.

---

## Open items for the orchestrator / sponsor

1. **In-flight tuner work.** `maya/86ca1fntp-playback-tuning` exists on origin — the PR that populated `PLAYBACK_OVERRIDES` (present on this branch at `:157-174`). Reconcile E4/E5 against any tuner UI already started on that branch before dispatch.
2. **Pingpong endpoint feel** is the one sponsor-preview gate (E1 AC5).

## Summary

5 children. Foundation-first (Pattern A): **E1 engine (in `spritePlayer.ts`) → E2 json→manifest plumbing → E3 cascade → (E4 spec ‖) → E5 tuner.** Ask 1 (speed) is mechanically done in the engine but needs E2 to satisfy the "edit animations.json" surface; Asks 2 (finalDwellMs) & 3 (pingpong) are the real engine gap (E1). Locked vocabulary extends the existing `PlaybackOverride`/`resolvePlayback` and adds `PlaybackMode`/`finalDwellMs`/`pose-defaults.json`. One sponsor-preview gate: pingpong endpoint feel.
