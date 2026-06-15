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

> **RESOLVED — the fix for "v3 keeps re-adding typing on a desk pose" is the PRO ENGINE on the ORIGINAL state, NOT a baked still-hands state (sponsor-validated 2026-05-29).** `read_at_screen` shares `active_work`'s desk state (head scans the monitor instead of typing). The obstacle was real: **v3 `animate_character` on a desk pose re-adds typing motion no matter how forcefully the `action_description` says "hands motionless / frozen / never type"** — 3 re-rolls all kept typing; the residual-motion model infers "at a desk → type" from the base pose and you cannot prompt it away in v3.
>
> ⚠️ A first "fix" attempt — `create_character_state` a dedicated state with still hands **baked in** (`34557d27`, derived from working `76d36df9`) — was tried and **ABANDONED**: it introduced a mouse/seat mismatch vs the working pose (so the dashboard still flipped) AND did not reliably stop the residual motion. Do NOT reach for a baked still-state here. (An earlier version of this doc wrongly recommended it — corrected.)
>
> **What actually worked: escalate the ENGINE to pro mode on the EXISTING working state.** `animate_character(mode="pro", confirm_cost=…)` on the original working state (`76d36df9` M01 / `d69b8c32` F01) held both hands planted on the keyboard AND produced the narrow head-sweep in ONE pass. Pro respects "hands stay completely still" where v3 ignores it. Cost: 20 generations / direction, south-only (we only render `south`). Pro picks its own frame count (returned 4f vs v3's 11f) — coarser, but the shipped playback overrides (slow speed + peak-frame dwell in `spritePlayer.ts`) smooth it. See memory [[project_pixellab_artisan_pro_escalation]]: with the Artisan plan (5000 gens/mo) pro is the DEFAULT escalation whenever a v3 desk/sitting pose won't behave — stop grinding v3 re-rolls. So the corrected rule: same posture + same body motion-class → share the state (v3 fine); same posture but the body must be STILL where the source moves → **share the state + use pro mode** (NOT a baked own-state).
>
> **`read_at_screen` validated `action_description` (NARROW sweep — distinct from the book full-sweep which OVERSHOOTS a monitor and makes the face leave the screen):** "the character sits facing the monitor and reads what is on the screen; the head turns only very slightly from side to side in a small narrow arc, the face always staying pointed at the monitor directly ahead and never turning away past the edges of the screen; starting at center the face turns just a little to the left to read the left of the screen, then just a little to the right by the same small amount, then back to center — a gentle narrow scan that stays within the width of the monitor; both hands stay completely still resting on the desk, the fingers never move and never type; smooth seamless loop returning to the start; only a small left-and-right head turn animates". (`read_at_screen` + `active_work` both live on M01 `76d36df9` / F01 `d69b8c32`, harvested into the shared `sitting_at_a_desk_fa` folder as a 2nd anim; the webview manifest disambiguates via the `<folder>/<anim_slug>` value form in `animations.json`.)
>
> ⚠️ **Read-at-screen failure modes + the torso-lock fix (M03 re-roll, sponsor-validated 2026-06-07 after a 5-attempt slog).** Pro `active_read` does NOT reliably reproduce across characters — M01's read landed clean first try; M03's (desk state `ff8ca3ab`) needed five pro re-rolls. Two distinct failures showed up and they pull in OPPOSITE directions, so target them precisely (ask the sponsor WHICH it is before re-rolling):
> 1. **Scan too WIDE** — the face turns far enough to leave the monitor ("looking way beyond the screen"). Fix: tighten amplitude wording ("never past the side edges", "within the width of the monitor").
> 2. **Vertical body BOB** — over-correcting toward "near-still / micro / no scan" makes pro drop the head-yaw and instead bob the whole torso up and down ("like nodding to a beat"). This is the trap: "make it stiller" → it stops yawing and starts bobbing. **The sponsor wants a HORIZONTAL head turn, not stillness.** Fix = the **torso-lock** prompt (M03-validated, anim `0b24254d`): *"The torso, shoulders and hips are completely frozen and do NOT move up or down — no bobbing, rising, lowering or leaning. ONLY the head turns: a gentle subtle yaw from center to a little left, then a little right, then back."* Naming the torso/shoulders/hips as frozen + "no vertical motion anywhere" is what kills the bob while keeping the yaw.
> - **Other pro artifacts seen on M03 reads (per-run variance, re-roll to clear):** a stray blob/headset near the head, and a **red tint bleeding onto the desk**. Counter both in-prompt: "add nothing near the head" + "keep every color identical to the reference; the desk stays brown; add no red or new colors." (Pro's 20-gen cross-reference can drift color/shape; the base STATE stayed clean throughout, so these are anim-level — re-roll, don't touch the state.)
> - **Process:** localize an artifact before re-rolling — composite base-pose vs active_work vs the read frames; if base + active_work are clean it's anim-level (re-roll the anim), not state-level (don't rebuild the desk). And gate the MOTION, not just a still — these failures only read in the loop.
> - **API note:** pro `animate_character` needs the price-check handshake FIRST (call WITHOUT `confirm_cost`), THEN `confirm_cost=true`. Calling straight with `confirm_cost=true` returned `status: already complete` and created NO animation (silent no-op).

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
  - ⚠️ **Sliding-keyboard gotcha (sponsor-caught 2026-06-07, F01 v3 active_work `fd32060f`→`8384b1f2`).** When the active_work residual includes a **hand-to-mouse / hand-to-keyboard move** ("the viewer-left hand slides to the mouse and back"), the model can animate the **furniture moving with the hand** — the sponsor saw the *keyboard itself slide left out from behind the monitor* as her hand reached. The hand-tracks-a-target verb leaks onto the prop. Fix (animation-prompt, re-roll the ANIM not the state — the furniture is fine in the still): name the furniture as **fixed and isolate the motion to fingers** — *"the keyboard, mouse, monitor and desk are FIXED furniture that stay completely still in place and NEVER move, slide or shift; only the hands and fingers move."* Same DISTAL-isolation family as the swinging-arms gotcha, extended to baked PROPS: when a residual moves a hand toward an object, explicitly pin every object or the object drifts to meet the hand.

⚠️ **Monitor-must-be-named gotcha (sponsor-caught 2026-06-06, M01 v3 re-roll `6b725758`→`b73d5b2e`).** A desk-state `edit_description` such as "sitting at a desk working at a computer" — even WITH explicit keyboard + mouse props — will bake a **monitor-less desk** (the character types at empty desk space) if the word "monitor" is not explicitly named. PixelLab does not infer a monitor from "working at a computer." The first M01 desk state (`6b725758`) was sponsor-rejected at the active_work motion gate with "no monitor". Fix: name the monitor as a physical prop AND describe it, e.g. *"On top of the desk in front of him stands a computer MONITOR (a screen on a stand), clearly visible facing him."* Same prop-baking class as the mouse-side gotcha — **the fix is re-roll the STATE, never the anim** (the monitor is baked scenery in the reference pose). The validated working recipe above already embeds "facing a computer monitor" precisely for this reason — do NOT drop or soften that clause when adapting the prompt to new characters. In south / low-top-down the monitor reads screen-toward-viewer with the keyboard tucked behind it; that is the correct perspective.

⚠️ **Baked-furniture poses must be COMPLETE GROUNDED mini-scenes when rendered over a full-bleed scene background (sponsor-caught 2026-06-03, ticket `86ca3mge9`).** The desk `active_work` pose was authored as a **waist-up** figure seated behind a *simplified, near-legless* desk-block. That reads fine on the old flat card, but once the scene-bg feature put a full-bleed room (`room3`) behind every tile, the pose **floats**: the idle poses are full standing characters whose **feet land on the room's wood floor** (grounded), so a waist-up seated figure on a legless desk-block — character legs occluded, no floor contact — visibly doesn't belong in the same room. **The constraint:** any pose that bakes furniture, when it will composite over a grounded room, must itself depict a *complete grounded scene* — chair + desk-with-legs + the character's legs visible under the table, in the same **low-top-down perspective** as the room — so the whole sprite grounds as one unit. The scene is a static bg layer and the character is a separate sprite layer on top, so they cannot be aligned at runtime; the pose sprite must self-ground. **Process lesson:** a cheap PIL composite of the EXISTING pose over the room (checking *grounding*, not just furniture collisions) would have caught this before ship — the earlier scene-clash composite test only checked for double-desk. (Fix VALIDATED 2026-06-03 — a re-genned full grounded desk pose (chair + desk-with-legs + legs-under-table, low-top-down) composites cleanly; see the recipe section below and `[[project_scene_bg_clash_finding]]`.)

### Seated desk poses for over-scene rendering — validated recipe (2026-06-03, ticket `86ca3mge9`)

A long iteration to ship a grounded "working at a desk" pose + 3-animation pool over the scene-bg room produced these reusable, non-obvious findings:

⚠️ **v3 `frame_count=16` BEATS `pro` for multi-phase / leg-stable SEATED animations — the opposite of the reading-sweep case.** `pro` returns a coarse ~4-frame loop: at tile size that reads as **blinking/jumping**, and on a full-body seated pose the **legs stomp** (measured frame-to-frame leg-region change 76–109px). The SAME motion as a **v3 16-frame** loop is smooth and keeps the legs **planted** (max ~0–4px drift). Use **v3 16f** for working/typing/mouse-cycle motions. Reserve `pro` for the narrow case where v3 structurally won't comply (hands must be STILL where the base pose implies motion — the `read_at_screen` finding above). NB pro 4f also has no `frame_count` control (the field is v3-only).

⚠️ **`create_character_state` is NOT a surgical edit — it re-synthesizes the whole sprite, drifting ONE detail almost every time.** Adding a mouse drifted the desk wood→pink one round and the trousers dark→brown another; a side instruction landed the mouse on the wrong side. `use_color_palette_from_reference=true` holds the *palette* but not textures/structure/placement. **Plan for re-rolls**, verify the WHOLE sprite after each edit (not just the thing you changed), and prefer the downstream recolor below for isolated color drift.

⚠️ **Post-process recolor BEATS a re-gen for an ISOLATED color drift.** If the drifted color is distinct from its neighbours (desk pink `(182,125,107)` is far from skin `(223,171,145)`), a **deterministic per-frame pixel remap at harvest** (`dist(c,PINK)<=~30 and dist(c,SKIN)>dist(c,PINK) → WOOD`) fixes it with **zero drift** to anything else — vastly more reliable than re-rolling the generation and hoping. When the color is NOT globally unique (trousers brown `==` desk-leg brown), **region-mask** it (only recolor within the trouser column/row box, e.g. cols 27-41 / rows 46-63). The recolor must run on the baked animation frames too (same map, all frames) — it's part of the asset pipeline, not a one-off.

⚠️ **Left/right placement: a south-facing character's RIGHT hand is the VIEWER'S LEFT.** To put a prop under the character's right hand, say **"on the character's right-hand side — the LEFT side of the image as the viewer sees it."** Bare "to the right of the keyboard" lands on the viewer's right (= the character's *left* hand) — wrong for a right-handed character. A wrong-side prop ALSO breaks reach animations: the hand crosses the body and v3 renders a **flail** ("throwing the mouse on the floor"). Fixing the side turned the same motion into a calm short reach.

⚠️ **Only the SOUTH frame ships — ignore non-south rotation artifacts.** The dashboard manifest references only `.../south/frame_NNN.png` (every path). A floor baked into the *east* rotation, or a different angle in *west*, NEVER renders. Don't chase rotation issues the user spots in the PixelLab UI — confirm only the south frame.

⚠️ **A "floor" can bake INTO the sprite — detect it by a solid bottom band.** Prompt phrases like "standing on a wood floor" / "floor line at the bottom" sometimes induce a **solid full-width opaque strip** in the bottom rows of the sprite, which double-floors over a scene-bg room. Detectable programmatically: scan the bottom ~10 rows — a clean sprite **tapers** (only desk-legs + feet, a handful of opaque px) while a baked floor is a **solid ~full-width band**. Avoid it with "a fully transparent empty background, nothing drawn beneath the feet" (PixelLab character gen defaults to transparent bg, so just removing the floor LANGUAGE usually suffices). It's generation variance — one char baked a floor on the same prompt another didn't; re-roll the offender.

⚠️ **v3 `animate_character` IGNORES prop-side placement in the `action_description` — bake the prop into the STATE first, then animate (validated F02, ticket `86ca5aczf`).** The left/right rule above governs `create_character_state` edits. For *animations*, v3 re-synthesizes the prop's position from its motion model and ignores viewer-side language in the anim prompt — on two consecutive F02 re-rolls, "the mouse on the LEFT side of the image as the viewer sees it" placed the mouse on the viewer-RIGHT both times (both anims deleted). This is distinct from the wrong-side→flail failure: the prop can be on the correct side in the state still and still migrate during the motion pass. **Fix: `create_character_state` with the prop correctly placed (per the handedness rule above) + `use_color_palette_from_reference=true` to prevent desk-color drift → gate the STILL pose confirming the side → THEN animate, with NO side-placement language in the anim prompt.** A baked, palette-locked prop in the state reference is authoritative; the motion pass respects the sprite layout even when it ignores placement text. Validated: baked-mouse state `f40fe102` (derived from `87980fad`) held the mouse on viewer-left through the full v3 anim `df6680f8`. Corollary: a wrong-side prop after animating means re-roll the STATE, not the anim.

⚠️ **`active_work` can be a MULTI-PHASE REACH LOOP, not just residual typing (validated F02, ticket `86ca5aczf`).** The standard recipe frames `active_work` as continuous-typing residual motion, but a richer cycle also works as ONE seamless v3 16-frame loop: both hands typing → the character's right hand slides across the desk to the mouse → moves it → slides back → both hands typing again. Validated constraints (anim `df6680f8`): (a) **"both hands stay low on the desk and never lift toward the screen"** — keeps the reaching hand from flying up (the flail failure) and the other hand anchored on the keyboard; (b) frame the whole cycle as **one continuous loop returning to the start**, not discrete "then/next" verbs (each transition verb risks being re-run as a repeating element per the core failure mode); (c) standard v3 16f + legs-planted framing still applies. This pattern REQUIRES the prop baked into the state first (gotcha above), and composes with `active_read` (pro 4f head-scan) on the SAME baked state so the mouse never blinks in/out as the dashboard toggles work↔read.

**Unified-pose-for-a-pool tip:** when several active animations must alternate on the SAME tile (a working "pool"), generate ONE shared base pose (e.g. both hands on keyboard + a mouse PROP on the desk) and animate all variants on it — otherwise props (a mouse) blink in/out as the pool switches. Cheap PIL composites over the room + a per-frame leg-stability metric are the fast judge for each candidate before committing to the bake.

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

## Workspace structure & cleanup safety

### The PixelLab account is SHARED across projects — always scope deletes

`list_characters` returns ALL characters across EVERY project using this account. As of 2026-06-04 that is 76 characters mixing ClaudeTeam personas with RandomGame's roster (Player Monk v3, Archive-Sentinel, a full S1 enemy set: Bone-Catalyst, Sunken-Scholar, NPC*, Grunt, Charger, Shooter, Stratum1Boss, PracticeDummy, and more). **Any delete has cross-project blast radius.** Rule: only ever delete characters whose name starts with `ClaudeTeam-` OR whose `get_character` `group:` field matches a known ClaudeTeam group_id (below). Anything else is do-not-touch regardless of how "unused" it looks.

### Group IDs vs character IDs

The IDs recorded in `assets/sprites/ClaudeTeam-{F01,M01}-Dev/animations.json` (`6603010c…` for F01, `ee57907c…` for M01) are PixelLab **`group_id`s**, NOT individual character IDs. A group contains multiple character entries: one base rotation character + one per pose state. The `group_id` is the cross-reference for future `create_character_state` calls; `character_id` is what `delete_character`/`get_character` take. (M02 is not yet harvested to disk, so it has no `animations.json` — its `group_id`/anchor come from `get_character`, not a committed file; see the table below. Beware: in `list_characters` the M02-Dev row surfaces by its **character_id** `7f65dc76…`, which is NOT its group_id.)

Confirmed groups (2026-06-04; M01 scratch deleted 2026-06-05; F01 rebuilt to v3 92×92 2026-06-07 — new group f60935b7, ticket 86ca5j1mt):

| Group | group_id | Members | Keep-anchor character_id |
|---|---|---|---|
| ClaudeTeam-F01-Dev | `f60935b7-e769-4613-8533-8e0c57a40ed5` | 5 (base + Sitting_at_a_desk_wo desk c175e6da + holding_a_coffee_cup 1ea5a97d + a_relaxed_tired_upwa e8cc443a + standing_in_a_relaxe 9118bf54) | `47692cce-2f6b-449e-9175-550334e261c9` (v3 92×92 rebuild; overwrote old 68×68 F01 in place — ticket 86ca5j1mt; desk state c175e6da holds BOTH active_work + active_read; member ids read from the harvested metadata.json) |
| ClaudeTeam-M01-Dev | `53712ca3-5239-44ae-a7e9-7ec361587e9e` | 5 (base + desk b73d5b2e + idle_coffee 1dd9fd2a + idle_stretch 28516a3e + idle_think d3a7150d) | `dfd4d94e-990c-4e8c-996d-31216b074929` (v3 92×92 rebuild; overwrote old 68×68 M01 in place — ticket 86ca5ed8v; desk state b73d5b2e holds BOTH active_work + active_read) |
| ClaudeTeam-M02-Dev | `77112ef7-dd4b-4495-8689-4cf5c9ca551c` | 5 | `7f65dc76-da9e-4e57-9926-d094077ef98b` (not yet harvested to disk; values from `get_character`) |
| ClaudeTeam-F02-Dev | `3839c05c-5f2a-4660-ab40-644068faade7` | 5 (base + idle_coffee/idle_stretch/idle_think + shared desk state) | `a8bccf92-ac1f-4990-95cd-6ad16bd56e3d` (first **v3 92×92** persona; harvested to disk 86ca5aczf; desk state `f40fe102` holds BOTH active_work + active_read) |
| ClaudeTeam-M03-Dev | `f6f4fbcb-13bb-49ac-8e8b-cba075c698c4` | 5 (base + desk ff8ca3ab + idle_coffee 4cc57e0d + idle_stretch e0ae7323 + idle_think 685d20cf) | `038a4e27-b8b0-4dcf-9f20-827d22ce243c` |

### Identifying the keep-anchor

Each group's **keep-anchor** is the base rotation character — `animations: none`, referenced by `group_id` in `animations.json`, the source for every `create_character_state`. NEVER delete it. The other ~21 group members are intermediate generation scratch states named by their `edit_description` prompt ("add a small computer", "holding a coffee cup", "sitting at a desk fa", "reading an open book", …). Many scratch names appear in BOTH the F01 and M01 groups, so **names alone cannot identify group membership.**

### Mapping a character to its group (list_characters limitation)

`list_characters` shows each character's group SIZE (`group(+N)` — e.g. `+21` = a 22-member group) but does NOT show the `group_id` per row. The only reliable membership check is `get_character(character_id)` → read its `group:` field. Identifying all members of a group therefore requires iterating the list and calling `get_character` on each candidate. There is no list-by-group endpoint.

### Delete safety checklist

`delete_character(id, confirm=true)` is **irreversible** (no recycle bin) and there is **no bulk/by-group delete** — always per-character. Functional value of deleting is ~zero: the sprite PNGs are already committed under `assets/sprites/<Char>/` and the extension makes no PixelLab API calls at runtime, so cleanup is workspace-tidiness only. Per orchestrator-autonomy rules, irreversible deletes are on the **never-auto-decide list** regardless of how mechanical the scope looks — surface the exact candidate list (each `id` + verified `group:` + confirmed not-an-anchor) and wait for explicit sponsor authorization before any `delete_character` call. Before each delete: (1) name starts `ClaudeTeam-` or group_id verified; (2) `get_character` confirms the target group; (3) it is not the keep-anchor.

---

## Operational pipeline (orch-driven; sub-agents lack PixelLab MCP access)

1. **Create base character** — `mcp__pixellab__create_character(description, view='low top-down', size=48, n_directions=4, mode='standard')` → 1 gen, ~2-3 min. This standing reference is the roster portrait + the source for every pose-state.
   - ⚠️ **v3 `size`: must be a MULTIPLE OF 4, and canvas ≈ `size × 1.9` — NOT the schema's standard-mode `×1.4` (validated 2026-06-14, M04/F03 gen).** The current roster standard is **`mode='v3'`** (always 8 directions — `n_directions` ignored), and the **92×92** canvas every v3 char uses comes from **`size=48`** (48 is a multiple of 4; 48 × 1.9 ≈ 92). Two traps hit this session: (a) `size=66` → hard error `Input should be a multiple of 4`; (b) `size=92` → a **176×176** canvas (≈ 92 × 1.9), NOT 92 — produced 2 oversized throwaway bases before correcting. So for a new v3 roster char use **`mode='v3', size=48, view='low top-down'`** and confirm 92×92 via `get_character` before building pose states. (The `mode='standard', size=48` form on this line is the LEGACY 68×68 recipe — M02-era only.)
2. **Sponsor approves the base character** before any states/anims are queued.
3. **Per pose — create the STATE** — `mcp__pixellab__create_character_state(base_id, edit_description=<state line>, use_color_palette_from_reference=<true for non-prop poses>)` → 1 gen, ~1-8 min. **Show the sponsor the still pose and gate it before animating** (prop orientation / seated pose are easy to get wrong).
4. **Per pose — animate the RESIDUAL motion on that state** — `mcp__pixellab__animate_character(state_id, action_description=<residual line>, animation_name, directions=['south'], frame_count=8-10)` → 1 gen, ~30-60s. South only (UI tile renders south; saves 3× per anim).
   - ⚠️ **Wall-clock at 92×92 (v3 standard) far exceeds the tool's UI estimate (observed 2026-06-06, M01 v3).** v3 `create_character_state` and v3 `animate_character` each ran **~5-6 min** wall-clock at 92×92 — NOT the "~1-8 min" / "~30-60s" the tool prints (those were calibrated on smaller sizes). Pro-mode `animate_character` (20 gen) matched its ~2-4 min estimate; only the v3 jobs under-report. Plan polling/wakeups at ~5-6 min per v3 job, not ~1 min.
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

## `active_pool` + the Playback Tuner "Active pool" / "Cycle over room" controls

**What `active_pool` is.** A character's `animations.json` MAY declare an `active_pool` — a list of distinct *working* poses (e.g. `["typing", "work_cycle", "work_focus"]`). When present, for a running agent with `tool != Read` the webview picks ONE pool member per active EPISODE and loops it (mirroring idle-episode stickiness), so the working tile has variety instead of one fixed pose. `active_work` remains the single-pose fallback for a character that has NO `active_pool`. `active_read` (`tool == Read`) is never pool-drawn.

**v3 characters now declare a 1-member `active_pool` (`["active_work"]`) — PR #208 / `86ca5ftzp`, 2026-06-07.** The original 68×68 chars (old M01/F01) shipped the rich model (14 idles + a 3-pose `active_pool`). The v3 92×92 standard (F02, M03, M01-v3) has a single work pose (`active_work` = typing) + a separate tool-gated `active_read`, plus a 3-member `idle_pool`. v3 chars originally declared NO `active_pool`, which left the tuner's Active-pool controls inert ("no active pool"). Sponsor wanted cycle-over-room usable on v3 chars, so each v3 char now lists its single work pose: `"active_pool": ["active_work"]`. This is **dashboard-safe**: a 1-member pool makes `pickActive` always return `active_work` (identical to the no-pool fallback), and `active_read` stays OUT of the pool so it remains `tool == Read`-gated. **Convention going forward:** every v3 char declares its work pose(s) in `active_pool` — one member today, and FUTURE chars with 2+ distinct work poses just list them all (the dashboard cycle + tuner cycle-over-room scale to any size, exactly like old M01's 3-pose pool). Do NOT put `active_read` in the pool (it would make the dashboard show the reading pose during non-read work).

**Playback Tuner controls that use `active_pool`** (`src/webview/components/playbackTuner.ts`):
- **Source dropdown ("Active pool")** — picks which anim list the **◄ Prev / Next ►** buttons walk. Default = the selected character's `active_pool`. Now that v3 chars have a 1-member pool, the readout shows the work pose (not "no active pool") and Prev/Next are enabled.
- **"Cycle over room" checkbox** — when ON, the preview auto-advances through the `active_pool` poses over the room background at the dashboard cadence (`claudeteam.activePoolLoopsPerPose`). For a 1-member pool it loops the single work pose; for a multi-pose pool it cycles them — the preview of how active-pool cycling looks in situ.
- ⚠️ **`active_work` is in `TUNER_HIDDEN_ANIMS`** (hidden from the plain Animation dropdown). When it's a character's sole `active_pool` member, the cycle would desync the dropdown to blank — `selectableAnimNames` un-hides `active_work` ONLY when it's in the selected char's own `active_pool` (PR #208; spec `team/iris-design/anim-tuner-spec.md:156`). A character where `active_work` is NOT a pool member still hides it.

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
