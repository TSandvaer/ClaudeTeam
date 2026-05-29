# Persona pixel character animation prompts

Reusable patterns for building persona pixel-character animations with PixelLab (`create_character_state` + `animate_character` v3) across the 10-character roster (M01-M05, F01-F05). **The architecture is STATE-PER-POSE (see the Architecture section), adopted 2026-05-28.** Validated against `ClaudeTeam-M01-Dev` (`7282cc3d-f822-492c-a790-08b3b5d2b27e`). Cross-references [`team/DECISIONS.md` § Persona pixel characters](../../team/DECISIONS.md) and memory `[[dashboard-whole-team-always-visible-thesis]]`.

For general PixelLab MCP usage rules (canvas-size trap, quantize duplicate-slot trap, prompt-literalism for `create_character`, doctrine-palette compliance), see RandomGame's [`.claude/docs/pixellab-pipeline.md`](../../../RandomGame/.claude/docs/pixellab-pipeline.md) — this doc layers the ClaudeTeam-specific persona-character usage on top.

---

## Architecture: STATE-PER-POSE is the standard (sponsor decision 2026-05-28)

**Every persona pose — idle (coffee), eating a snack, stretching, on the phone, hands-on-hips, working at a computer, reading — is its own `create_character_state`, NOT an animation on the base character.** Each state bakes the pose (and any prop) into the character's reference rotation; the animation on that state is then ONLY the small residual motion (throat swallow, jaw, typing fingers, head scan). This generalizes the reading fix (below) to the entire pose set.

**Why:**

- It eliminates the entire "verb repeats / pose collapses to reference" failure class **at the source**. A loop animated on the BASE character keeps snapping back to the arms-down standing reference between cycles and re-runs any setup verb (raise cup, raise book, sit down). When the held pose IS the reference (a state), there is nothing to re-run and nothing to collapse to.
- It is far more **repeatable** across the 10-character roster — the pose is locked by the state; you only tune a tiny motion. Re-roll churn drops sharply.

**A character is therefore a GROUP:** the base character (standing reference, for the roster portrait) + one state per pose, each state carrying exactly one residual-motion animation. Sibling states share a `group_id`; the harvest ZIP bundles them all (see Webview wiring note).

**Identity-consistency watch-item.** Each `create_character_state` re-synthesizes the sprite, so a character's appearance can drift slightly between its own poses. Mitigation: pass `use_color_palette_from_reference=true` for NON-prop poses (stretch, hips, working) to lock colors to the base. For prop poses (coffee/book/phone/snack) leave it OFF — the prop needs its own colors — and accept minor drift; at 68px, and since poses swap only on activity-change (not rapidly), it reads fine. Eyeball a character's full pose set together before locking it in.

**State-per-pose ≠ state-per-animation: two behaviors that SHARE a posture get TWO animations on ONE state (sponsor-caught 2026-05-29).** State-per-pose means each distinct POSTURE is its own state — it does NOT mean each animation is its own state. When a new behavior must look identical to an existing pose except for the residual motion (e.g. `read_at_screen` = the `active_work` desk posture but the head scans the monitor instead of typing), DO NOT `create_character_state` again — that re-synthesizes a near-but-not-identical desk pose, so the dashboard visibly "flips" between the two almost-matching postures when the agent toggles between the behaviors. Instead `animate_character` a SECOND animation directly onto the EXISTING state (its `character_id`), giving that state two animations that share pixel-identical rotations/posture and differ only in motion. A PixelLab state holds N animations; the webview manifest maps both canonical names to the same folder, different `animations/<slug>/`. **Finding an existing state's id:** the harvested `metadata.json` does NOT store per-state PixelLab ids (only folder + character-name), so use `list_characters` and discriminate by group suffix — M01 group shows `group(+18)`, F01 `group(+15)`, M02 `group(+4)` — plus the pose name + anim count (the real `active_work` has `1anim`; a stray no-anim duplicate is likely a wrong `create_character_state`).

> **CAVEAT — the 2-anims-on-1-state trick only works when the BODY POSE is unchanged; if the new behavior changes the body, it needs its OWN state (sponsor-caught 2026-05-29, cost 2 wasted gens).** `read_at_screen` was meant to share `active_work`'s state and add a head-only scan. It FAILED: v3 `animate_character` on a desk pose keeps re-adding **typing** motion no matter how forcefully the `action_description` says "hands motionless / idle / frozen" (2 re-rolls, both kept typing). Reason: the residual-motion model infers "at a desk → type" from the base pose; you cannot prompt that away. **Rule:** if the new behavior needs a DIFFERENT body pose than the source (here: idle hands vs typing hands), `create_character_state` a dedicated state with that pose **baked in** (`edit_description="both hands rest still and motionless ON the keyboard and mouse, not typing"`), derived FROM the sibling state (`create_character_state(76d36df9, ...)`, not from the base char) so seat/scale/proportions still match and there's no flip — THEN animate head-only on it. This is the same bake-the-pose / animate-the-residual logic as the book-reading two-entity pattern. So: same posture + same body motion-class → share the state; same posture but the body must be STILL where the source moves → own state with the still pose baked. (`read_at_screen` lives on its own state, e.g. M01 `34557d27`, derived from working `76d36df9`.)

---

## Core failure mode: v3 custom animations REPEAT every verb within the loop

*(This is WHY state-per-pose exists — read it to understand the failure the architecture sidesteps.)*

Any verb implying a transition (`lift`, `raise`, `shift`, `step`, `walk`, etc.) gets interpreted as a repeating motion inside the loop cycle. A character described as "lifting coffee cup to take a sip" will lift and lower the cup eight times in eight frames — reads as weight-lifting, not idle drinking. The cycle does NOT naturally hold the raised pose.

**Validated failures + fixes on M01 (2026-05-27):**

| Anim | Failed prompt fragment | Symptom | Validated re-roll |
|---|---|---|---|
| `idle` (coffee) | "casually taking a sip ... slight shift in weight between feet" | Character swung arms like marching ("shift weight" → continuous walking motion) | "holding a coffee cup at the mouth and taking a slow lingering sip, cup stays pressed to lips for the entire motion, only the throat moves to swallow" |
| `idle` (coffee, v2) | "slowly raises a coffee cup to take a small sip then lowers it" | Cup raise/lower cycle ("lifts weights" feel) — cup didn't dwell at mouth | (same as above — dwell-emphasized + "only X moves" framing) |
| `reading` (book) | "standing holding an open book with both hands at chest height" | Book lifted and lowered repeatedly ("holding" parsed as repeating lift) | **NO single-loop prompt fixes this** — see "Reading: the two-entity pattern" below. A loop cannot hold a one-time raise; the wrap re-raises every cycle. The fix is a `create_character_state` reading pose + head-only loop, NOT a cleverer prompt. |

> **Process note (2026-05-28):** an earlier version of this doc marked a "raises once at the start, then holds still" reading prompt as `sponsor-validated 2026-05-27`. It was NOT — the sponsor inspected it 2026-05-28 and it still re-raised the book every loop. **Never mark an anim prompt "validated" until the sponsor has approved the MOTION in the PixelLab UI**, not just the stills. Premature validation cost a re-roll cycle.

---

## Residual-motion prompt grammar (the animation queued on a state)

Because the pose is already baked into the state's reference rotation, the `action_description` only describes the small living motion and locks everything else:

```
<held prop/pose> stays completely still the entire motion, only the <body-part> moves <small action>, the body does not <shift / stand / lower / move the desk>
```

Three load-bearing elements:

1. **`stays completely still the entire motion`** — locks the prop/pose so PixelLab doesn't synthesize incidental motion (the swinging-arms / desk-rising failure mode).
2. **`only the <body-part> moves`** — names the ONE thing that animates.
3. **`smooth continuous loop that returns to its starting pose`** — the loop MUST be seam-free. Persona anims play **continuously for the entire time the agent is in that state** (a long Read loops `reading` many times), so any per-cycle reset is highly visible. Author **oscillating / cyclic** motion that returns to neutral (center→left→center→right→center), NOT one-way (left→right, which snaps on wrap). Explicitly forbid depth/lean motion — at 16 frames the reading loop invented a "book-pull toward the face" that reset every cycle (sponsor-caught 2026-05-28). Fewer frames + "constant distance, never leans in, returns to starting pose" suppress it.

Under state-per-pose you rarely need "once at the start" language anymore — there is no setup verb to cap, because the setup IS the state's reference pose.

---

## Per-pose recipes (state `edit_description` + residual `action_description`)

Each pose = `create_character_state(base_id, edit_description=<state line>)` → **sponsor approves the still pose** → `animate_character(state_id, action_description=<residual line>, animation_name=<name>, directions=['south'], frame_count=N)`. `<name>` is the webview trigger anchor (see Naming convention).

⚠️ **Gate the still pose with the sponsor BEFORE animating** any state — prop orientation + pose angle are subtle at 68px and easy to get wrong. Fetch the `get_character` preview, show the sponsor, get a thumbs-up, THEN spend the anim gen. (Skipping this burned a gen on the reading pose 2026-05-28.)

> Prompts below are **drafts pending per-pose sponsor approval** as M01 is rebuilt under state-per-pose (2026-05-28). Mark each `validated` only after the sponsor approves the MOTION in the UI.

### Idle pool (per `[[dashboard-whole-team-always-visible-thesis]]` — 3-5+ variants per character so the always-visible tile isn't repetitive)

**idle (coffee sip)** — `animation_name: idle`
- state: `holding a coffee cup up at the mouth with one hand in a relaxed standing pose, the cup pressed against the lips`
- residual: `the cup stays pressed to the lips and both hands stay completely still, only the throat moves slightly to swallow, the body does not shift`
- The single-loop coffee prompt was sponsor-approved on the base char 2026-05-27; re-done as a state for uniformity + to remove reference-collapse jitter.

**idle_snack (eating)** — `animation_name: idle_snack`
- state: `holding a small snack up at the mouth with one hand in a relaxed standing pose`
- residual: `the hand stays at the mouth completely still, only the jaw moves with small nibbling bites, the body does not shift`

**idle_stretch** — `animation_name: idle_stretch` · `use_color_palette_from_reference=true` (no new prop) · **GESTURE pose — the motion IS the content (not held + residual)**
- state: `a relaxed tired upward stretch, both arms reaching up overhead with the hands nearly together and elbows softly bent, body gently arched backward as if stretching after sitting at a desk a long time, calm and relaxed`
  - ⚠️ **Celebration gotcha (sponsor-caught 2026-05-28):** "both arms extended straight up" alone reads as a **celebration/cheer**. "hands nearly together + soft elbows + arched back + tired" reads as a stretch.
- anim (full gesture, not residual): `a slow stretching loop: from the overhead stretched pose the arms lower to about shoulder height then lift back up overhead into the stretch with the hands nearly together, holding briefly at the top; the body stays standing in place; smooth continuous seamless loop that returns to its starting pose; only the arms' lift and a slight head tilt move`
  - Animate the lift on the STATE (not the base char) so the hands-together peak shape is preserved — animating "raise arms into a stretch" on the arms-down base risks regenerating the celebration shape at the peak.
  - ⚠️ **Exercise-reps gotcha (sponsor-caught 2026-05-28):** a continuous lift loop reads as exercise reps. **Fix at RENDER with a long dwell on the arms-overhead peak frame** (stretch up → HOLD → relax → repeat), NOT by regenerating. See the Playback-speed note's dwell guidance.

**idle_phone** — `animation_name: idle_phone`
- state: `holding a phone in front of the chest with both hands, head tilted down looking at the screen`
- residual: `the phone and both hands stay completely still and the head stays tilted down, only a subtle thumb-scroll on the phone screen animates`

**idle_hips** — `animation_name: idle_hips` · `use_color_palette_from_reference=true` (no new prop)
- state: `standing with both hands resting on the hips`
- residual: `both hands stay on the hips and the body stays still, only the head turns slightly left then right to look around`

### working (at computer) — `animation_name: working` — triggered by tool ≠ Read

⚠️ **Desk-rises-from-the-ground gotcha (sponsor-caught 2026-05-28).** Animating "sitting at a desk" on the standing base character made the desk/table animate up out of the ground each loop (the setup verb being re-run) plus a standing→seated flash. The state-per-pose fix bakes the desk + seated pose into the STATE's reference, so the desk is simply *there* and never moves.
- state: `sitting at a desk facing a computer monitor with both hands resting on the keyboard, the desk monitor and keyboard fully in view, focused expression looking at the screen`
- residual: `the character stays seated and completely still, the arms and forearms stay resting in place on the desk and do not move, the desk monitor and keyboard stay completely still, only the fingers make small rapid typing taps on the keyboard and the head stays facing the screen, the character never stands up and nothing else moves, smooth continuous seamless loop`
  - ⚠️ **Swinging-arms gotcha (sponsor-caught 2026-05-28):** "only the hands type" still let the model swing the whole arms. Explicitly **lock the arms and forearms** ("arms and forearms stay resting in place and do not move") and isolate the motion to "only the fingers make small typing taps". Same principle as `only the <body-part> moves`, but push the named part as DISTAL as possible (fingers, not hands).

### reading (book) — `animation_name: reading` — triggered by tool == Read

The **canonical worked example** of state-per-pose — full recipe + gotchas immediately below.

### Reading book — triggered by tool == Read — THE TWO-ENTITY PATTERN

**This is the repeatable recipe for EVERY character's reading anim (M01-M10, F01-F05).** Do NOT try to animate "raise book + read" as one v3 loop — it is structurally impossible (the loop wrap re-raises the book every cycle; see the failure table above). Instead, split the held pose from the residual motion across two entities:

**Step 1 — create a "reading pose" character state (book already raised).** `mcp__pixellab__create_character_state(source_character_id, edit_description=...)`. The state's BASE pose holds the book up, so the head-turn loop has nothing to re-raise.

```
# reading-pose state edit_description — TWO non-negotiables: (1) book held UP AT CHEST HEIGHT, (2) head BOWED FULLY DOWN. Use this F01/M02-validated wording VERBATIM for every character — do NOT reword "up at chest height" to "lower / at rest / arms bent close to body / not raised" (that is the #1 reading failure cause; see the book-height gotcha).
reading an open book held up at chest height with both hands, the head bowed fully down with the chin lowered toward the chest looking straight down at the book, the plain back cover of the book faces outward toward the viewer while the open pages face inward toward the character's own face, calm relaxed reading pose
```

⚠️ **Book-orientation gotcha (sponsor-caught 2026-05-28).** In the south/front view, a person reading toward himself must show the **plain back cover** of the book to the viewer — the open pages face HIS face, away from the camera. PixelLab's default renders the open white pages facing the camera (looks like he's *showing* the book to you, not reading it). The edit_description MUST say "back cover faces outward toward the viewer, open pages face inward toward his own face" or the pose is wrong. **This is baked into the STATE pose, not the animation — fixing it requires re-rolling the state, not the anim.**

⚠️ **Book-HEIGHT gotcha — THE #1 reading failure cause (M02 2026-05-28, confirmed by a 3-agent frame analysis).** If the STILL pose renders the book held **low / at the belly / arms at rest**, the v3 loop synthesizes a *"raise the book up into reading position"* as the first move of EVERY cycle — exactly the "he's pulling the book up and bowing his head before moving" artifact. Frame evidence: M02's low-book state rose ~4-5px over frames 000→002 (a pitch+lift setup) before any yaw; M01/F01's book-up states have frame_000 ≈ the still pose, so the motion is pure yaw with nowhere to lift. **The cause is the STATE's book height, NOT the anim prompt** — you cannot suppress it with anim wording. In fact heavy negations ("the book is glued / never rises / never lifts" ×3) did NOT help and likely *amplified* the raise by naming it; M01's gentle no-negation prompt worked. **Fix: re-roll the STATE until the still renders the book clearly UP at chest height; gate that still pose specifically checking book height before animating.** Wording trap that caused this: an over-correction to "lower chest height, arms bent close to the body, not raised" (intended to give less lift-room) did the opposite — a book at rest *invites* a raise. Use F01's "held up at chest height" verbatim.

⚠️ **Gate the still pose with the sponsor BEFORE animating.** Book orientation + book-HEIGHT (see above) + head-down angle are subtle at 68px and easy to get wrong. Fetch `get_character` preview, show the sponsor the static reading pose, get a thumbs-up on book orientation AND that the book sits high at the chest, THEN spend the anim gen. Skipping this gate burned a gen on 2026-05-28.

**Step 2 — animate head-only on the state.** `mcp__pixellab__animate_character(state_id, action_description=..., animation_name="reading", directions=["south"], frame_count=10)`.

```
# reading head-turn loop action_description — VALIDATED full-sweep, fc=10 (sponsor "YES THATS IT.... PERFECT", M02 2026-05-28). Use VERBATIM on every character.
the head stays bowed down looking at the book the entire time and does a full even reading sweep from side to side: starting at center, the face first turns clearly to the LEFT to read the left page, then sweeps all the way across to the RIGHT to read the right page, turning by the same amount to each side so the left and right are covered equally, then sweeps back — the head reaches just as far left as it reaches right; the chin stays low near the chest the whole time, the head never lifts up, never drops further down, and never moves closer to or farther from the book, staying at exactly the same height and distance; the book and both hands stay completely still; smooth continuous seamless loop that returns to its starting pose; only the left-and-right head turn animates
```

**Use fc=10, never fc=8.** fc=8 compresses the loop and makes any residual setup more jarring; fc=10 is the validated value for M01/F01/M02.

⚠️ **Reading = ONLY a left-right head turn. THE FIX IS THE STATE, NOT THE PROMPT (sponsor-validated 2026-05-28 on M01 + F01 + M02).** Reading is the **most variance-prone pose**, with TWO state-level failure modes that anim wording cannot fix — both live in the reference pose, so re-roll the STATE, don't burn anim re-rolls:
- **(1) Book-raise setup** — book rendered low / at-rest → the loop raises it into reading position every cycle (the "pulling the book up + bowing the head before moving" artifact). Fix = the state must render the book UP at chest height (see the book-HEIGHT gotcha above). This was **M02's dominant failure**, isolated by a 3-agent frame analysis; heavy "never rises / glued" negations did NOT suppress it and likely amplified it.
- **(2) Head-nod/dive** — the model pitches the head DOWN toward the page instead of yawing side-to-side. Fix = re-roll the STATE with the head BOWED FULLY DOWN (chin toward the chest) so there is no downward room left; only yaw remains. This was **F01's failure** (the SAME M01 prompt + 3 rewordings at fc=10/8/6 all kept diving until the bowed-down state fixed it).
- **Budget a STATE re-roll for reading.** Use F01's exact state wording verbatim (book UP at chest + head bowed fully down) and gate the still pose (book high AND head fully bowed) before spending the anim gen.
- **Symmetry (the recurring one across M01, F01 AND M02):** the default result scans only **center→right** and never reaches the left. The gentle F01 phrasing ("a little to the LEFT … a little to the RIGHT") was NOT enough on M02. The **validated fix is the stronger full-sweep wording in the Step 2 block above** — name LEFT first, frame each direction as *reading that page*, and demand **equal amplitude** ("reaches just as far left as it reaches right"). fc=10. A one-sided result means the sweep wording wasn't forceful enough — re-roll the anim with the full-sweep text (the STATE is fine for this one; symmetry is an anim-prompt fix, unlike the two failures above).
- Diagnostic: curl frames 0/3/6, Read them. A down-nod shows MORE top-of-head/hair at the mid-frame; a yaw shows the face turned to one side; a book-raise shows the book-top-edge pixel row rising several px between frame_000 and the mid-frame.

**Step 3 — cleanup.** After the head-only loop is sponsor-approved, delete the stale single-loop `reading` anim from the BASE character (`delete_animation`), and delete any abandoned reading-pose states (`delete_character`). NOTE: `delete_character` may trip the auto-mode classifier (destructive, character not created "this session" from its view) — surface to the sponsor for authorization or have them delete in the UI.

**Webview wiring note:** the reading anim lives on a *different* character UUID (the state) than the base character's idle/working anims. The harvest ZIP is grouped — downloading the state UUID returns BOTH states' anims under sibling folders (`<BaseName>/` + `<state-folder>/`) keyed in `metadata.json` by `group_id` → `states[]`. The webview reverse-map must pull `reading` from the book-state folder and the idle/working pool from the base folder.

---

## Frame count guidance

- **8 frames** (default): short loops (sip, hand-on-hips look-around). Cost: 1 gen.
- **10 frames**: smoother slow loops — the reading head-scan uses 10 to keep the slight left-right turn gradual. Cost: 1 gen (frame count does NOT multiply cost).
- **16 frames**: **costs 2 gens/direction** (observed 2026-05-28), NOT 1 — per-direction cost doubles at the high end. Interpolation may also go soft. Exact threshold for the 2× tier within 12-16 is untested. Use only when a slower/smoother loop genuinely needs it (and note: playback speed is better tuned at render time — see below).

**Playback speed is a CONSUMER concern, not a regeneration.** PixelLab produces frame images only — the harvested `metadata.json` carries frame *paths*, no per-frame timing. How fast an anim plays is decided entirely by whatever renders it (the dashboard webview), via per-frame display duration. To slow an anim down, the webview holds each frame longer (e.g. 160ms vs 80ms) — **zero gens, infinitely tunable**. Adding frames only slows playback in a fixed-per-frame player (like PixelLab's own UI preview) and is the blunt lever (capped at 16, softness >12). **The speed seen in the PixelLab UI preview is NOT the dashboard speed.** Capture desired per-anim speed as a webview-render requirement for the integration ticket, not a generation parameter. **Default to SLOW playback** for the calm always-visible feel — the render should hold each frame noticeably longer than real-time. `reading` and `idle_snack` were both sponsor-confirmed "slow it down at render" (2026-05-28); treat slow as the persona-anim default, faster as the exception. Sponsor-confirmed direction 2026-05-28.

**Per-frame timing can be NON-UNIFORM — dwell on a key frame.** Beyond uniform-slow, the render can hold ONE frame far longer than the rest. `idle_stretch` (2026-05-28): the arms-overhead peak frame must be HELD a while before the loop continues, so it reads "stretch up → hold → relax → pause → repeat" instead of rhythmic exercise reps. `idle_phone` (2026-05-28): hold the LAST frames before the loop restarts (scroll → pause → scroll), plus slow playback. The dwell point varies per anim (stretch = overhead peak; phone = end-of-loop), but **a hold-before-restart is becoming the DEFAULT idle treatment** — without it, short idle loops read mechanically/repetitively. Capture per-anim **dwell frames** (which frame index + hold duration) as part of the render requirement — this also suits the sip-at-lips / nibble peaks. So the render integration needs: (a) per-anim default playback ms, AND (b) optional per-frame dwell overrides (default: hold the final frame(s) before restart).

### Per-animation playback override table (webview render config — 86ca1fntp)

The webview `spritePlayer` (`src/webview/sprites/spritePlayer.ts`) carries a per-character override table `PLAYBACK_OVERRIDES[characterName][canonicalAnimName] → { speedMultiplier?, dwellFrameIndex?, dwellMs? }`. Defaults: `FRAME_MS_DEFAULT = 160ms/frame`, `DWELL_MS_DEFAULT = 400ms` (final-frame idle dwell), `PEAK_DWELL_MS_DEFAULT = 600ms` (peak-frame hold when a `dwellFrameIndex` names no explicit `dwellMs`).

- **`speedMultiplier` is a fraction of the default RATE.** 50% speed = half the rate = `FRAME_MS_DEFAULT / 0.5 = 320ms/frame`; 70% = `160 / 0.7 ≈ 229ms/frame`. Absent → 1.0 (160ms).
- **`dwellFrameIndex` holds ONE mid-sequence apex frame** for `dwellMs` extra. Composes additively with the final-frame idle dwell when the apex coincides with the last frame. Out-of-range indices are ignored (frame counts differ M01 vs F01).
- **Reduced-motion** still shows frame-0-only with no timer — overrides never run under `prefers-reduced-motion: reduce`.

| Canonical anim | speedMultiplier | M01 peak frame | F01 peak frame | Notes |
|---|---|---|---|---|
| `active_read` | 0.5 | — | — | reading head-sweep, slowed |
| `active_work` | 0.5 | — | — | typing, slowed; no final-frame dwell (active loops are continuous) |
| `idle_coffee` | 0.5 | 4 | 4 | cup-at-mouth hold (9-frame loop, mid-loop) |
| `idle_snack` | 0.5 | 4 | 4 | hand-at-mouth hold (9-frame loop) |
| `idle_stretch` | 0.5 | 8 | 5 | arms-fully-up apex; M01 re-peaks overhead at frame 8, F01's gentler raise maxes at frame 5 |
| `idle_phone` | 0.5 | 4 | 4 | phone-at-face hold (9-frame loop) |
| `idle_hips` | 0.5 | — | — | |
| `idle_think` | 0.5 | — | — | |
| `idle_arms_crossed` | 0.5 | — | — | |
| `idle_pockets` | 0.5 | — | — | |
| `idle_neck_roll` | 0.5 | — | — | |
| `idle_yawn` | 0.5 | — | — | |
| `idle_watch` | 0.5 | — | — | |
| `idle_headphones` | 0.7 | — | — | |
| `idle_wave` | — (1.0) | — | — | unchanged |

Peak indices were read off the harvested south-view frames (M01 stretch starts at the overhead peak and re-peaks overhead at frame 8; F01 stretch is a gentler raise maxing around frame 5). **The sponsor visually tunes the exact feel (speed + dwell ms + peak index) on reload** — this table is the starting point, all values are render-time-tunable with zero gens.

---

## Operational pipeline (orch-driven; sub-agents lack PixelLab MCP access)

1. **Create base character** — `mcp__pixellab__create_character(description, view='low top-down', size=48, n_directions=4, mode='standard')` → 1 gen, ~2-3 min. This standing reference is the roster portrait + the source for every pose-state.
2. **Sponsor approves the base character** before any states/anims are queued.
3. **Per pose — create the STATE** — `mcp__pixellab__create_character_state(base_id, edit_description=<state line>, use_color_palette_from_reference=<true for non-prop poses>)` → 1 gen, ~1-8 min. **Show the sponsor the still pose and gate it before animating** (prop orientation / seated pose are easy to get wrong).
4. **Per pose — animate the RESIDUAL motion on that state** — `mcp__pixellab__animate_character(state_id, action_description=<residual line>, animation_name, directions=['south'], frame_count=8-10)` → 1 gen, ~30-60s. South only (UI tile renders south; saves 3× per anim).
5. **Sponsor approves each pose's MOTION individually** before the next pose. Re-roll rule: if the *motion* is wrong → `delete_animation` + re-animate; if the *pose/prop* is wrong → `delete_character` the state + re-create it (the pose lives in the state, not the anim). `delete_character` may trip the auto-mode classifier — surface for sponsor authorization or have them delete in the UI.
6. **Harvest** — bulk-download the GROUP ZIP (any member UUID returns ALL sibling states) to `assets/sprites/<uuid>/_pixellab_anims/`:
   ```bash
   curl -fsSL -o ./_tmp.zip "https://api.pixellab.ai/mcp/characters/<uuid>/download" \
     && mkdir -p assets/sprites/<uuid>/_pixellab_anims/ \
     && unzip -q -o ./_tmp.zip -d assets/sprites/<uuid>/_pixellab_anims/ \
     && rm ./_tmp.zip
   ```
   (Returns HTTP 423 until in-flight jobs finish — use `curl --fail` + a short retry loop.) NOTE: the `auto-pixellab` queue was built to animate ONE character; for state-per-pose its queue rows must add a `create_character_state` step before each animate. Until that skill is updated, drive state-per-pose manually.

   ⚠️ **Harvest ONCE at the end, to a single canonical dir — do NOT harvest per-pose.** Because any member UUID's download returns the WHOLE group, harvesting after each pose creates redundant per-UUID dumps of the entire group (M01 accumulated **4 dirs / 362 PNGs** of mostly-overlapping content before this was caught). Skip per-pose harvests — sponsor inspects motion in the PixelLab web UI, not on disk. When all the character's poses are sponsor-approved, do ONE consolidated harvest into `assets/sprites/<CharName>/` (e.g. `assets/sprites/ClaudeTeam-M01-Dev/`), and delete any stray per-UUID dirs.

   ⚠️ **Before harvesting, enumerate the group and prune stray `(copy)` states.** `mcp__pixellab__list_characters` shows every state with its group + anim count. A state whose name ends in **`(copy)`** is a **PixelLab web-UI duplicate** (browser right-click → Duplicate / Ctrl+D on a selected state) — NOT something the MCP produced: `create_character_state` always names a state after its `edit_description` verbatim and never appends a `(copy)` suffix. These copies are empty (0 anims) and harmless until harvest, where they'd add a redundant sibling. Delete them with `delete_character(confirm=true)` (verify 0 anims first). Seen 3× across M01 + F01 — assume one or two will appear per character and check the group count against your expected `base + N poses` before harvest.

---

## Naming convention (canonical — sponsor-locked 2026-05-29)

Two prefixed namespaces, no bare names. The webview trigger map keys on these canonical names via the per-character `animations.json` manifest (see below — PixelLab does NOT export the semantic name).

| Anim | Webview-side trigger |
|---|---|
| `idle_coffee` | Idle pool member (the original coffee-sip; NO bare `idle` — every idle carries a descriptor) |
| `idle_<descriptor>` — `idle_snack`, `idle_stretch`, `idle_phone`, `idle_hips`, `idle_think`, `idle_arms_crossed`, `idle_pockets`, `idle_neck_roll`, `idle_yawn`, `idle_watch`, `idle_headphones`, `idle_wave` | Idle pool members; webview picks one at random from the `idle_*` pool |
| `active_work` | Tool use where `tool != Read` (was `working`) |
| `active_read` | Tool use where `tool == Read` (was `reading`) |

⚠️ **PixelLab does NOT export the semantic `animation_name` — author an `animations.json` manifest (validated 2026-05-29 harvest).** The harvested `metadata.json` keys each state's animation by an auto-generated *action-description slug + hash* (e.g. `the_raised_open_hand_sways_gently_side_to_side_in-38411c09`), and the state folders are description-slugs (`standing_upright_wit`, `holding_a_coffee_cup`) — the `animation_name` you pass to `animate_character` (`idle_wave`, etc.) is NOT in the export anywhere. So the canonical naming cannot be "baked at generation" and cannot be normalized via metadata keys (there are none). Instead, **commit a hand-authored `assets/sprites/<Char>/animations.json` mapping canonical name → folder** (see `ClaudeTeam-M01-Dev/animations.json`): `{ "animations": { "idle_coffee": "holding_a_coffee_cup", "active_work": "sitting_at_a_desk_fa", ... }, "idle_pool": [...], ... }`. The webview trigger map reads THIS file, not `metadata.json`.

- Do **NOT** rename the harvest folders to canonical names: it forces a re-rename on every future harvest/re-roll (PixelLab always re-exports slug folders) + large git churn. The manifest decouples cleanly and is re-harvest-safe. (Sponsor-confirmed 2026-05-29.)
- For NEW characters (M02-M05, F02-F05): author `animations.json` the same way after harvest — PixelLab won't carry the semantic names regardless of what you pass to `animate_character`.
- Map folder→canonical by the state UUID (recorded at create-state time) cross-checked against the metadata animation action-slug; prune any 0-anim `(copy)`/stray state's folder before commit.

PixelLab unpacks the ZIP with description-slug folder names. For the authoritative canonical map use the committed `animations.json` (above); `metadata.json` remains useful for frame paths + provenance only (see RandomGame's `pixellab-pipeline.md § Folder-rename + reverse-map` for the general convention this supersedes for ClaudeTeam personas).

---

## Cost model for the full roster (10 chars × 7 poses, state-per-pose)

- Base character creation: 10 × 1 gen = 10 gens
- Pose-state creation: 10 × 7 × 1 gen = 70 gens
- Residual-motion animations: 10 × 7 × 1 gen = 70 gens
- Re-roll buffer (state-per-pose lowers churn — assume ~25% combined re-roll on pose OR motion): +40 gens
- **Total estimate: ~190 gens** against Tier 1's 2000/mo — still well within budget (~10%).

State-per-pose roughly doubles the per-character gen count vs. animating the base directly (≈15 vs. 8 gens/char), but the reliability gain cuts the re-roll rate (the dominant churn source), so real-world totals land close.

---

## Cross-references

- [team/DECISIONS.md § 2026-05-27 — Persona pixel characters replace color dots](../../team/DECISIONS.md)
- [team/DECISIONS.md § 2026-05-28 — State-per-pose is the standard](../../team/DECISIONS.md)
- Memory: `[[dashboard-whole-team-always-visible-thesis]]` — why idle variety is load-bearing
- RandomGame project [`pixellab-pipeline.md`](../../../RandomGame/.claude/docs/pixellab-pipeline.md) — general PixelLab MCP usage (orchestrator-only access, canvas-size trap, doctrine palette compliance, ZIP folder-rename + reverse-map, cost model)
- Auto-pixellab skill at `~/.claude/skills/auto-pixellab/SKILL.md` — overnight harvest loop
