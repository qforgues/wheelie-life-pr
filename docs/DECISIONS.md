# Wheelie Life PR — decisions log

Choices made while building the first playable, and why. The brief was "make
sensible calls and write them down", so this is that list. Anything here can be
overturned — it's a record, not a constitution.

---

## 1. Stack: Vite + TypeScript + Three.js, custom physics, zero art assets

No Unity, no Unreal, no physics engine. The prototype is ~4 000 lines of
TypeScript and builds to a **154 kB gzipped** bundle that opens instantly in any
browser.

A general-purpose rigid-body engine would have been the wrong tool. The whole
game is one axis — pitch about the rear contact patch — and it needs to be
authored to a feel, not simulated generically. A bespoke model of that one axis
is both more controllable and about a tenth of the code.

Every texture and mesh is generated at runtime from canvas 2D and box/cylinder
primitives. That keeps the repo tiny, means no asset pipeline to maintain while
the art direction is still moving, and makes the whole look re-tunable by editing
numbers instead of opening a DCC tool.

## 2. The bike is a *built* Grom, not a stock one

A stock 125 cc Grom makes ~10.9 N·m. To lift the front of a 172 kg bike-plus-
rider with the CG where it sits, you need about **21 N·m at the crank in 1st**.
The arithmetic is in `tools/simcheck.ts`. A stock Grom therefore physically
cannot power-wheelie — real ones need a clutch pop or a bump, which is exactly
what riders report.

Rather than fake the physics, the tuning models a bike with a big-bore kit:
**21 N·m, 21 hp**. That's a 181/190 cc kitted Grom, which is one of the most
common builds in the actual scene the game is about. The physics stays honest and
the bike does what the box art shows.

`sim/tuning.ts` is the only place any of this lives. Swap the numbers and you
have a different bike.

## 3. No balance meter, and none is coming

The brief was explicit and it's the right call, so the game leans into it. What
replaces a meter:

| Channel | What it tells you |
|---|---|
| **The horizon** | The camera swings out to the side and drops as the front comes up, so the bike's angle against the skyline is readable at a glance. This is the primary cue. |
| **Engine note** | Synthesised from actual rpm — a four-stroke single fires once per two revolutions, so the fundamental is `rpm / 120` Hz. You hear the motor load and unload. |
| **The tail scraping** | Past 60° the back of the bike drags: sparks, and a rising metallic scrape in the mix. That sound *is* the warning. |
| **Controller rumble** | Weakest exactly at the balance point, rising as you drift off it and as the bike rolls. "The pad goes quiet" means "you found it." |
| **Rider body language** | The rider visibly sits back and stiff-arms the bars as you pull back. |

The HUD shows speed, gear, a tacho and wheelie distance. A tacho is not a balance
meter — it's an instrument a real bike has, and manual shifting needs it.

## 4. Pitch is modelled about the rear contact patch, so the balance point is emergent

`BikeSim.stepRiding` integrates:

```
J · θ̈  =  m·a·h′  −  m·g·d′  +  τ_yank  −  c·θ̇  +  τ_scrape
```

where `(d′, h′)` is the CG offset from the rear contact patch rotated by the
current pitch, and `J = I_cg + m·L²`. This comes straight out of a Lagrangian for
a body rotating about a rolling contact.

The good part is what falls out for free:

- `d′` reaches zero at `θ = atan(d/h)`. **That angle is the balance point** — 43.8°
  neutral, 36.0° with the rider sat all the way back. It isn't a constant anyone
  typed in; it moves when the rider moves.
- Past it, gravity's sign flips and throws you over. The instability is real, not
  scripted.
- More throttle means more `a` means more lift. Braking means negative `a` means
  the nose comes down. Both for free, no special cases.

One deliberate approximation: the fully coupled two-DOF solve puts `I_cg + m·d′²`
in the denominator, which collapses toward zero at the balance point and makes
pitch response effectively infinite there. That is technically correct for an
idealised rigid body and completely unrideable. Real bikes don't behave that way
because of tyre carcass compliance, suspension and a rider who is not welded to
the frame. The rear-contact formulation above is the well-behaved version, and
it's what the genre uses.

## 5. One brake input, distributed by the sim

The brief says "L2 brake" and "brake can save a wheelie", so there's a single
brake axis. While both wheels are down it splits 42/58 rear/front. **The moment
the front leaves the ground, all of it goes to the rear**, because that's the only
wheel touching anything.

That single rule produces the save mechanic with no special-casing: a stab of
brake in a wheelie is a large rearward force at ground level, which is a large
nose-down torque. Verified in the harness — the bike recovers from past the
balance point at 1.85 rad/s.

## 6. The tail actually drags

Past 60° the back of the bike contacts the road and gets both a nose-down torque
(430 N·m at the loop-out angle) and a drag force (340 N). Added after the first
tuning pass, where the gap between "up" and "gone" was about a tenth of a second.

It's physically real — it's why stunt bikes run cages — and it converts the last
twenty degrees from a cliff edge into a fight you can still win. It's also the
loudest thing in the mix at that angle, so the safety net announces itself.

## 7. Which gears can lift, and why that's the design

From `npm run sim`:

| Gear | Roll-in | Pin it + pull back |
|---|---|---|
| 1st | 16 mph | Lofts, and **loops if you keep holding it** |
| 2nd | 29 mph | Lofts, and loops if you keep holding it |
| 3rd | 43 mph | Lifts ~3° — needs a speed bump or momentum |
| 4th/5th | 56 / 68 mph | Won't come up on power |

So: **lift it in 1st or 2nd, then row up through the gears to keep it going.**
The autopilot in the harness holds one for 259 m through to 4th gear at 71 mph.
That's the skill loop, and it's why manual shifting matters — an upshift cuts
torque for 190 ms and drops the nose 4.5°, so you have to feed the pull-back
through the shift.

Three speed bumps sit on the avenue at z = 30, 190 and 330 specifically so 3rd
gear has a way up.

## 8. Locked 120 Hz physics, rendering uncapped

`core/Loop.ts` is a fixed-step accumulator. A variable timestep changes how the
bike feels between a 60 Hz laptop and a 144 Hz monitor, and how it feels is the
entire product. Frame deltas are clamped at 250 ms so a backgrounded tab doesn't
fire a thousand steps on return.

## 9. `src/sim/` imports nothing — that's the console port path

The sim layer has no Three.js, no DOM, no browser API beyond `performance.now()`.
It talks to the rest of the game through two plain structs (`RiderInput` in,
`BikeState` out) and one interface (`GroundProvider`).

`tools/simcheck.ts` runs it under Node with no browser at all. That harness is
both how the bike gets tuned and a standing proof the boundary hasn't leaked — if
it ever fails to bundle, something rendering-related got into `sim/`.

**Xbox is the only console target, and PS5 is dropped.** A web build cannot run
on a PS5 at all: its browser is not user-reachable, so getting there would mean
Sony developer registration, a devkit and a rewrite in Unity or Unreal. Xbox
ships Edge as a free installable app that can open any URL, so the existing
build runs there today. Everything the interview specified in DualSense terms
maps one-for-one to an Xbox pad — the Standard Gamepad layout puts the triggers
at 6/7 and the shoulders at 4/5 either way — so nothing about the control design
changed, only the printed labels.

What the sim boundary still buys, if a native port is ever wanted: it is
"rewrite the render/audio/input adapters and translate ~600 lines of
well-specified physics", with `simcheck` as the acceptance test — same inputs,
same numbers, or the port is wrong.

## 10. Deliberately not in the prototype

No traffic, no police, no night, no weather, no bike selection, no missions, no
save data, no multiplayer, no menus beyond the controls card. All of it was
scoped out to get riding and wheelies right first.

The one thing that snuck in beyond the brief is **controller rumble**, because
the Gamepad API makes it about fifteen lines and it's the balance channel that
most makes up for having no meter.

## 11. Roll instability is on, but gentle

Holding a wheelie straight is genuinely hard on a real bike, and modelling it as
an inverted pendulum on the roll axis is easy. But cranked up it makes the
prototype miserable to learn on. Default `rollInstability` is **0.5** of realistic,
with generous self-centring, and the debug panel has a **Chill** preset that sets
it to zero along with a wider save window.

## 12. Crash resets drop you back in rolling

25 mph in 2nd, ~24 m back up the street, 1.5 s after the wipeout. Resetting to a
standstill turned every attempt into a six-second run-up, which wrecked the
practice loop. Second gear at 25 mph is exactly wheelie-ready.

## 13. Tiling lives on the geometry, not on the texture

The first real Xbox test came back as a photo of a blank white viewport with a
live HUD over it: DOM, sim and save all working, canvas drawing nothing.

The cause was texture memory. `texture.repeat` is a property of the *texture*,
so every surface wanting a different tile rate had been given its own
`clone()` - and three.js uploads every distinct `Texture` object to the GPU
separately even when they all share one canvas. The city was holding **232
textures backed by 54 images**, roughly 309 MB, which the console browser's
memory ceiling would not take. It dropped the WebGL context, and with no
listener attached the canvas simply stopped updating.

Tiling now goes into the mesh's UVs (`scaleUV` in `view/geometry.ts`) and one
texture serves every wall, road and sidewalk: **53 textures, 53 images, ~70 MB**,
with no visible change to the city.

Three supporting choices, all "never show a white screen again":

- **`preventDefault()` on `webglcontextlost`.** Without it the browser never
  fires `webglcontextrestored` and the canvas is dead for the life of the page.
- **The loop keeps running while the context is gone.** Stopping it also stops
  the diagnostics panel and the toast - the two things that explain the failure.
  The bike freezes and the draw is skipped; the UI stays live.
- **The Xbox starts at the `low` tier.** The quality governor only ever steps
  *down*, so by the time it reacts to a memory problem the context is already
  gone. Shadows are worth less than a picture. Justin can raise it from the
  debug panel now that the diagnostics panel reports real fps.

Anything that still escapes - no WebGL2 at all, for instance, which three.js has
required since r163 - now paints a readable message instead of nothing.
