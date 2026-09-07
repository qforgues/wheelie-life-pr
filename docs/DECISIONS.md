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

## 12. Crash resets drop you back in rolling, always in 1st

~24 m back up the street, 1.5 s after the wipeout. Resetting to a standstill
turned every attempt into a six-second run-up, which wrecked the practice loop.

Originally this came back in 2nd. That was wrong for a reason that took a
player to spot: the gear you restarted in depended on whether you had just
crashed or just loaded the page (a fresh spawn is 1st at a standstill), so
"what gear am I in" became something you had to check rather than know. It is
now **always 1st**.

Speed is capped per bike rather than fixed, because 25 mph in 1st is 94% of
redline on the Grom - the starter bike - which would mean upshifting before you
could even pull. `BikeSim.reset` clamps road speed to whatever the requested
gear carries at 68% of redline, so every bike lands in its powerband:

| | respawn |
|---|---|
| Grom | 18 mph, 6120 rpm |
| YZ250F | 25 mph, 8770 rpm |
| Streetfighter | 25 mph, 3879 rpm |

All three lift on throttle-and-pull straight from there, and none of them
respawns against the limiter.

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

## 14. Traffic is dumb on purpose

Sixteen cars drive the avenue, eight per lane, wrapping round when they run off
the end. Each one holds its lane at a constant speed with a small per-car pace
multiplier so the line doesn't move like a train.

No lane changes, no braking, no following distance. That is a choice, not a
shortcut: traffic that reacts unpredictably makes a crash feel like the game's
fault rather than yours, and threading a gap is only a skill if the gap is
readable before you commit to it.

Speed is a menu setting - **off / slow / regular / fast** - because Justin asked
for the toggle, and because learning to hold a wheelie is hard enough without a
Corolla in the way. Regular is 11 m/s, about 25 mph. The setting is saved.

Traffic advances on the **fixed physics step**, not the render frame, so a car's
drawn position and the box `collide()` tests can never disagree.

The car model is baked down to one mesh per material (19 meshes -> 7) and every
car shares those geometries, so a full street of traffic costs about 110 draw
calls rather than 300.

## 15. Beta is localhost. Live is the Xbox. Sign-off is the gate.

`npm run deploy` no longer deploys. It runs the checks, builds, and prints how
to try the result on localhost. Publishing is `npm run deploy:live`, which only
runs when a human passes `--live`.

Alongside it, every build now carries an identity - `0.1.0+20260906.14d4e28` -
stamped into the bundle by Vite *and* written to `version.json` by the same
build, so the two can never disagree. The menu shows it, which is how Justin can
say which version he is actually testing.

A running game polls that manifest and, when it differs, raises a flag on the
HUD and the menu. **It never reloads itself.** Nobody gets rebooted out of a
wheelie; the player installs when they choose. Because Vite fingerprints every
asset, the old build keeps working indefinitely.

### The cache problem, and the actual fix

`index.html` is the one file whose name never changes, so a cached copy pins the
whole game to an old bundle. `public/_headers` now marks it `no-cache`,
`version.json` `no-store`, and the content-hashed `/assets/*` immutable.

That only helps the *next* load, so the game can also do a hard refresh itself:
**Force refresh** on the menu clears Cache Storage, drops any service worker and
reloads through a URL the cache has never seen. A controller cannot ask the
browser for Ctrl+Shift+R, so the game has to own it.

## 16. A fake contact shadow when the real ones are off

The `low` tier turns shadow mapping off, which is right for the Xbox but leaves
the bike reading as though it floats. One 128px alpha blob under the contact
patches puts it back. It shrinks and slides rearward as the front lifts, which
is deliberate: the shadow leaving the front tyre is the clearest read on how far
over you are, and that matters most on the tier that has no other shadow.

## 17. The city is a grid, and the grid is the only source of truth

The map was one avenue with two side streets. Good for proving the physics,
wrong for riding around in: every run was the same straight line.

Roads are now two arrays of centrelines - `avenueX` and `streetZ` - and
*everything* derives from them: the tarmac, the kerbs, where buildings stand,
where traffic drives, where the police route, and what the GPS draws. Adding a
road is one number in one array. Nothing in the file knows about "the avenue"
any more; "am I on tarmac" is a distance-to-the-union-of-road-strips test.

Roughly 3.5x the area of the old map, and it draws **cheaper** than the old one
did - 1266 calls / 173k triangles at a centre junction, against 1422 / 386k
before. Three things paid for it:

- **Scenery is bucketed into 60 m cells** and cells past 320 m are switched off
  wholesale. One visibility flag beats a per-object frustum test, and the fog
  hides the edge.
- **Cars were the entire budget.** A filleted box at 10 segments is 1200
  triangles, and the car model used that for its body *and* its cabin. With
  traffic on every road that was more geometry than the whole city. Dropped to
  3-4 segments, which still catches a highlight on something seen at speed from
  behind, and cut the car count per lane.
- **Shop signs are cached by what they say.** Every sign painted its own canvas,
  so a few hundred buildings meant a hundred GPU textures for about two dozen
  distinct signs - the exact fault that ran the Xbox out of memory once already.
  42 textures now, on a map three times the size.

## 18. The GPS is north-up

A rotating map is prettier and much harder to read at a glance, and a glance is
all you get while holding a wheelie. Drawn straight from `LAYOUT`, so it cannot
go stale when a road moves.

## 19. Police care about wheelies, not driving

Heat climbs **only while the front wheel is up**, faster when a patrol can see
you. Riding normally is free. That makes a long wheelie down a main road a risk
you are choosing, and ducking down a side street to cool off a real tactic
rather than a loading screen.

Three levels, as the interview asked, and one warning before any of it - the
first time heat crosses level 1 you get "¡BÁJALA!" and nothing else happens.

Patrols route along the grid rather than driving through buildings, and they are
not fast enough to catch a bike that keeps moving. Measured: sitting still while
wheelieing gets you pulled over in about 17 seconds; riding hard up the avenue
never gets caught. Being busted is nearly always the result of stopping,
crashing, or dead-ending yourself.

Two things that were deliberately *not* done:

- **A bust is not a game over.** Justin's whole loop is "wreck and go again". It
  costs a fifth of your cash, capped, and puts you back on the road. The fine is
  proportional so it stings the same when you are saving for your first bike and
  when you already own the Ducati.
- **The router had to be fixed twice.** Patrols originally drove to the junction
  nearest the rider, which meant they stalled a block away and never arrived; at
  a junction they then re-picked the leg they were already parked on. Both were
  found by simulating a chase rather than by watching one.

## 20. Police difficulty is a ladder, and the old tuning made them impossible

Five settings: **none / lazy / pro / aggro / ice**, saved between sessions.

Shipping the first version taught us something the simulated chase had not.
The test held a wheelie for ninety seconds; a person does three seconds up and
five down. Heat rose at 0.14/s and decayed at 0.22/s, so breaking even required
wheelieing **61% of the time** - and a real rider never saw a single patrol.
The feature was live and inert.

The fix is that interest lingers: `coolDelay` seconds of clean riding before
heat falls at all, which is how a wanted level has always worked and is what the
first version was missing. Measured against realistic riding:

| | 2s up / 8s down | 3s up / 5s down | 5s up / 4s down | 8s up / 3s down |
|---|---|---|---|---|
| none | never | never | never | never |
| lazy | never | never | — | 13 s |
| pro | never | 11 s | 5 s | — |
| aggro | — | 3 s | — | — |

Two properties worth keeping: barely wheelieing stays clean even on **pro**, so
learning is never punished; and **lazy** ignores anything short of a committed
run.

**ICE** is the exception to the whole design - `alwaysHunting`, so heat climbs
whether or not you have done anything, and the only way out is distance. Riot
units are a visibly different vehicle: matte black instead of white, amber and
white lights, a push bar and a caged cabin, because what is coming for you has
to be readable from a long way off.

The scanner is **$6,000**, between the YZ250F and the Ducati. It reveals patrols
on the GPS - it has never gated whether police exist.

## 21. The GPS arrow was rotating backwards

World heading is `(sin yaw, cos yaw)` and the minimap draws +Z up with the
canvas Y axis inverted, so the heading on the canvas is `(sin yaw, -cos yaw)`.
A canvas `rotate(θ)` sends the arrow's tip `(0, -1)` to `(sin θ, -cos θ)`, so θ
must be `+yaw`. The code had `-yaw`: turn right, arrow swings left.

Found by riding, not by testing - it is the kind of sign error that looks
perfectly reasonable in the source and is obvious the moment you steer.

Verified by transforming the tip through the real canvas matrix at north, east,
south and west and comparing against `(sin yaw, -cos yaw)` - exact at all four.
A pixel-based probe was tried first and was worse than useless: it looked for
the cyan pixel furthest from centre, and on this arrow the *rear corners* are
further out (7.81) than the tip (7.5), so it measured the tail.

## 22. Which thing stays still is a setting

**MAP FIXED** keeps the city still and turns the arrow: better for building a
picture of where you are. **ARROW FIXED** keeps the rider upright and turns the
city, so "left on the map" is always "left on the screen": better for following
a turn. People are genuinely split on this, so it is a toggle rather than a
decision, and north gets marked with an N when the city is the thing rotating.


## 23. Police are scenery first, a threat second

The first version only created patrols once heat was up, which meant a city with
no police in it: you could ride for ten minutes and never see one, and the
difficulty tiers were invisible until you had already misbehaved.

Each tier now puts a **shift** on the road, cruising the grid whether or not
anyone is wanted, and the tier decides how many. Heat breaks the nearest ones
off to chase; the rest carry on with their beat. Measured over a four-minute
clean lap of the city:

| | on shift | patrols passed | chasers while riding clean |
|---|---|---|---|
| none | 0 | 0 | 0 |
| lazy | 3 | 2 | 0 |
| pro | 6 | 7 | 0 |
| aggro | 9 | 15 | 0 |
| ice | 12 | 54 | **8** |

Three details that carry the idea:

- **Lights only run on a chase.** A patrol on its beat is just a car, which is
  what makes one lighting up mean something.
- **Beats are aimless on purpose.** A patrol that drifted toward the rider
  without chasing would read as buggy rather than watchful.
- **The nearest cars break off**, so the patrol you just rode past is the one
  that comes after you.

Cost at the console tier: ICE with twelve on shift is 69 draw calls and 10k
triangles over `none`, because patrols past 260 m keep driving but stop being
drawn.

## 24. Culling hides geometry; it does not free it

Justin's Xbox reached the menu and went white on RIDE. The menu renders one
still frame from the spawn point; riding moves you through the city.

That distinction is the whole bug. Distance culling switches cells off, which
saves draw calls - but **once a mesh has been drawn its buffers stay resident**.
Riding around therefore uploaded the entire city, cumulatively, until the
console ran out. The menu never did, which is exactly why the menu worked.

Measured, then fixed:

| | before | after |
|---|---|---|
| meshes | 4088 | 3026 |
| unique geometries | 3459 | **1061** |
| vertices | 769k | **220k** |
| geometry memory | 31.8 MB | **9.6 MB** |

Three causes:

- **Buildings grew through each other at every block corner.** Rows along the
  avenues and rows along the streets both ran to the junction, so each corner
  had two buildings inside one another. Rows now stop clear of the perpendicular
  row's depth. This alone removed about a thousand objects.
- **Every building owned its geometry.** Sizes are rounded to a step (2 m of
  width, 1.5 m of height) and the shell is shared: 76 shells for the whole city.
  Nobody can tell 18.3 m from 18 m across a street; the GPU can tell 300 buffers
  from 30.
- **168 unique palms were 40% of every vertex in the scene**, all subtly
  different heights nobody could pick out. Palms, railings, planters and balcony
  slabs are now bucketed and shared.

## 25. A white screen has to explain itself

Two changes so this is never guesswork again. Each frame stage is wrapped, so a
single throwing frame reports once and the loop carries on - previously one bad
frame meant every subsequent frame threw too, nothing was drawn again, and the
screen simply went white with no clue why. And errors are written to
localStorage as they happen, so the *next* load surfaces what killed the last
one. On a console there is no devtools; "it went white, I reloaded" now has to
be enough.

## 26. Mirrors: which thing is fixed, and where they hang

`CORNERS` is a HUD element - easy to read, out of the way. `ON THE BIKE` brings
them inboard and down to roughly where bar-end mirrors sit in a rider's view,
and further in and down again in first person, where the bars are closer. A five
button pad trims them within modest limits. Saved between sessions.

## 27. Being pulled over now shows itself

A patrol drew alongside and some seconds later you were fined, with nothing on
screen in between - which reads as the game deciding rather than you being
caught. There is now a progress bar while contact is being made, and it drains
the moment you break away. The information is the point: it turns a penalty into
a situation you can still ride out of.

## 28. Points double while you are wanted

Heat used to be pure downside - a tax on doing the thing the game is about - so
the correct play was always to keep it cool, and the whole police system was
something to avoid rather than something to use.

Everything ridden while wanted now counts **double**, and it stacks with tricks:

| | cool | wanted |
|---|---|---|
| plain wheelie | 1x | **2x** |
| knee on the seat | 1.6x | **3.2x** |
| standing | 2.4x | **4.8x** |

100 m standing on the seat while wanted pays $958, against $200 for the same
100 m ridden quietly. Backing off is now a decision rather than the obvious
answer, and standing on the seat with three cars behind you is exactly as
reckless as it sounds.

Applied per metre rather than to the whole run, the same way the trick
multiplier is - so the bonus is on the distance you actually earned it over,
not retroactively on the metres you rode before anyone noticed.

## 29. The sky blue was not sky

Everything off the road network was simply nothing, so you looked straight
through the world at the sky dome. It read as haze right up until you rode into
it and kept going.

Grass is laid as tiles filling the gaps **between** road corridors, rather than
one sheet with holes cut in it: a single plane under the city would either bury
the roads or float above them, and cutting holes in it is a lot of work to
arrive at the same rectangles. Every tile shares one material and they merge
into a single mesh, so the entire ground is one draw call - and the scene got
*smaller*, from 9.6 MB of geometry to 5.7 MB, because the same pass tightened
the building rows.

## 30. The mirrors had their halves the wrong way round

Reported from riding: "the blue car in my right mirror is behind me on my left."

The mirror camera looks backward, which is a three.js camera's *default*
orientation, so its screen-right is world **+X**. The rider's right is **-X**.
Everything to the rider's rear-left therefore lands in the **right** half of
that render - so the left mirror has to take the right half, and vice versa.
Splitting them the obvious way round put traffic on the wrong side of you.

Proved rather than reasoned: two markers 14 m behind the rider, one on each
side, rendered into the mirror target and read back. The rider's-left marker
landed at x=287 of 512, the rider's-right at x=193 - the halves are swapped,
exactly as the report said.

The horizontal flip on top is separate and was already right: it is what turns
a rear-facing camera into a mirror, so the outer edge of the glass looks wide
and the inner edge looks back along your own bike.

## 31. Patrols were driving through buildings, for two separate reasons

Reported from riding: "cops occasionally patrol off road and disappear into
buildings."

**One:** the turn-rate limit added to stop chasers tracking like a magnet was
being applied to cruising cars too, so every beat patrol cut every corner.

**Two, and the bigger one:** `wander()` returned a *junction* as the waypoint,
but a car mid-block is not standing on a junction - so the straight line to it
ran diagonally across the block. Every waypoint must now share a road with where
the car actually is, so the line to it runs **along** that road.

Cars on a beat drive straight at their waypoint (no turn limiting), which keeps
them on the centreline by construction. Chasers keep the turn limit, because
missing you is the point of it.

Verified: 9 cars, 5 minutes, 10,800 samples, **worst 0.000 m off road**.

A note on the testing, because it cost two rounds: the first version of this
test used the ICE tier, which `alwaysHunting` - so its patrols were chasing, and
going off-road was *correct*. The test now asserts `chasers === 0` and fails
loudly rather than quietly measuring the wrong thing.

## 32. The rider's helmet was black-on-black

The helmet already had a chin bar, a visor and a peak. It still read as a
featureless sphere, because every one of those parts was the same near-black as
the shell: the visor was `0x1a2430` on a `0x1b1c20` shell.

A helmet is recognised by **contrast**, not by having the parts. The shell now
takes the bike's own colour, the eye port behind the visor is matt black so
there is a hole to look into, the peak and vents are white trim, and the visor
is a light mirrored blue. Same geometry, plus a couple of vents - it reads as a
helmet from across the street now.

Also: gloves and boots. Hands were bare skin balls and feet were off-white
pebbles; the chain end can now take any geometry, so a foot is boot-shaped and
the boot carries a cuff and a strap in the bike's accent colour.

## 33. Each bike needed the one thing it is recognised by

- **Grom**: flat angular shrouds kicked out from the tank with a hard crease
  down them, plus an air scoop and a belly pan. Almost every photo of a modern
  Grom is taken at the angle that shows those panels, and the bike had none.
- **Streetfighter V4**: the engine was a featureless grey block because the
  cylinder banks were buried behind the tank. Cam covers out on the flanks, the
  round clutch cover every Ducati has on its right, and the radiator filling the
  gap under the steering head - which on a naked bike is most of what you see.

## 34. Upgrades, and why levels must not stack

Four parts, three levels each, bought per bike. They exist to give money a second
job: the only thing to save for was the next bike, so once you owned the Ducati
earning stopped meaning anything.

The first version applied every level owned, in order - so three engine levels
were 1.12 x 1.22 x 1.35, **84%** more torque from a part labelled "+35%". A
fully built Grom then looped out under its own power **0.6 seconds** after you
touched the throttle, with the rider sat neutral. Thirty-six thousand dollars to
make the bike unrideable.

Only the highest level of each part applies now. A level is the state the part
is in, not a purchase added to the last one - which is also how anyone reads
the labels.

Each part had to buy something you can *measure*, and each had to cost
something:

| build | 0-30 | max lean | trade |
|---|---|---|---|
| stock | 2.12 s | 45° | |
| engine 3 | **1.43 s** | 45° | loops at 2.2 s if you are lazy with it |
| weight 3 | 1.72 s | 45° | lean 32° -> 35°, but nothing steadies it |
| tyres 3 | 2.12 s | **60°** | no straight-line gain at all |

Tyres originally changed nothing measurable - grip is not what limits a Grom off
the line - so a £5,200 part bought a number nobody could feel. They now buy lean
angle before the bike lets go, which is what grip actually gives you.

## 35. The city was submitting 187 triangles per draw call

Profiled because it felt slow, and the numbers said something specific: the
**low** tier ran at 13.5 ms against high's 19 ms with *identical* draw calls and
triangle counts. Shadows and resolution were not the bottleneck. 997 draw calls
for 186k triangles is about 187 triangles each - almost pure overhead - and 2144
separate objects to walk every frame.

Two changes, both aimed at object count rather than pixels:

**Cells are baked.** Nothing inside a cell moves, so a block of buildings has no
reason to be three hundred objects. Each cell is merged down to one mesh per
material after the city is built. Per cell rather than city-wide, so the
bounding boxes stay small and distance culling still works.

**Six facades, one material each.** After the bake a cell costs exactly one draw
call per material it holds, so every extra facade is another mesh in every block
that uses it. Twelve facades with a light and a dark variant was 24 wall
materials and dense corners were 31 meshes. The dark variant went too - it
doubled the mesh count for a shading difference you cannot pick out from the
road.

| | before | after |
|---|---|---|
| draw calls | 997 | **533** |
| low tier | 13.5 ms (74 fps) | **~10 ms (~100 fps)** |
| wall materials | 24 | **6** |

Worth writing down: the first measurement was meaningless because the tab was
backgrounded, so rAF was paused, nothing had uploaded and every cell still read
as visible. Frames are now driven by hand with a `gl.finish()` so the timing is
real.

## 36. Chains, and engine covers instead of a grey crate

A bike without a visible chain reads as a toy however good the bodywork is - it
is the one part that says the back wheel is driven. All three now have one: two
straight runs between the sprockets rather than a swept loop, because at
chase-camera distance the top and bottom runs are all you ever see, plus teeth
around the rear sprocket so it reads as a sprocket rather than a disc. On the
Ducati it sits on the open side, which is the entire point of a single-sided
swingarm.

The YZ's engine was a plain grey box and it is the largest thing on the side of
the bike. It now has a clutch cover and an ignition cover, both proud of the
case, polished, and ringed with bolts so they read as castings.

## 37. The back print had to go

A flat square plane sitting proud of the jacket, which read as a parachute
rather than a graphic. A decal only works on a surface that curves with it, and
this one sat off a filleted box - it had already been moved once to stop the
fillet dragging its UVs around the corner. Removed, along with the texture
generator that fed it.

The torso was one smooth slab, which is most of why the rider read as a
mannequin. It now has the things a jacket actually has: a collar standing off
the neck, a yoke across the shoulders, a zip down the front only, a hem that
stops, and cuffs where the sleeve ends. All of it follows the same box, so
nothing floats.

## 38. The Grom's forks were the wrong way up

The fat tube was at the bottom, which is a conventional fork. A 2022-on Grom is
upside-down: the fat outer tube is clamped at the top and a thin chrome slider
runs down to the axle, with a carrier at the bottom. That inverted stance is a
large part of why the current bike looks like it does.

## 39. The minimap was mirrored

Reported as "the map isn't turning right when I am locked in with the arrow, I
can't explain how it is off" - which is exactly how a mirrored map feels. You
can see it is wrong and not say why.

Three.js is right-handed with Y up, so facing +Z your right hand points at **-X**
- steering right takes the bike toward -X, measured rather than assumed. The map
drew +X to the right, so the entire world was flipped left-to-right against what
the rider experiences. Looking down at a scene with +Z up puts +X on the LEFT.

Flipping the x axis meant the arrow rotation, the track-mode rotation, the north
marker and the scanner heading stubs all had to follow. Verified by probing
pixels: a landmark on the rider's right now draws on the right of the map at
every heading in track mode, which is the defining property of that mode, and
the arrow aligns with the heading within measurement noise at N/E/S/W.

## 40. Both billboards, and where a board can be seen

Two bugs, both mine. The boards sat 33 m out on each axis, which is past the
building rows (they end at 24 m) and therefore in the middle of a block, hidden
from every road - nobody ever saw one. They now stand in the corner void
between roughly 8 m and 25 m, which building rows leave clear, facing the
junction down the diagonal.

And only one of the two designs was ever built: `n++` post-increments, so
`art[n % 2]` was evaluated with an always-odd `n` and always picked the same
board. Counting the boards placed rather than the junctions visited fixes it.

## 41. G cycles the GPS

M was already mute, so the map took G: fixed, then arrow-fixed, then off. D-pad
down on a controller.

## 42. Nine upgrades, and the one that did nothing

Four more parts to make a 3x3: swingarm, gearing, clutch on the bike, plates on
the rider. That is nine, which is what a three-by-three grid holds.

**Brakes were tried first and thrown away.** Every level was measured and every
level did nothing: stopping from 30 mph went 7.4 m to 7.3 m, and the wheelie
save - the thing the blurb promised - took 0.46 s at *every* level. Brake torque
already saturates the available grip, so buying more of it is physically
meaningless in this model. That is the second upgrade written that could not be
felt; the rule now is that a part ships only once a measurement shows it
changing something.

The replacement is a **swingarm**, which is the mod a wheelie bike actually
gets. Moving the axle back lengthens the wheelbase and puts the CG further ahead
of it, so the balance point rises - 43.8° stock to 48.7° extended - and the bike
wants to sit up. It steers like a bus in exchange.

Gearing trades top end for pull (0-30 in 2.12 s to 1.81 s). Clutch shortens the
shift (2.12 s to 1.95 s). Plates are rider-scope like the scanner and slow the
police down: heat builds at 0.52x and fades at 2x when fully done.

## 43. The Grom had no small parts

It read as Lego because it had no hardware on it - a real one is covered in
little bits, and those are what the eye uses to decide something is a machine
rather than a moulded shape. Radiator, header heat shield, mirrors on stalks,
amber indicators front and rear, a rear hugger and a chain guard. None of it is
big and all of it is load-bearing.

## 44. Street life, and what it cost

More palms, people on the pavement, dominoes in the plaza, and a tenth of the
traffic on cuatrimotos - which is how the island actually rides.

The pedestrians nearly went out the door at 2,000 triangles each: 125k across
the city, two thirds of the entire scene, for figures you pass at 30 mph. Cut to
a few hundred each and cached by colour, they are 32k. Five shirt colours became
two for the same reason facades went from twelve to six - after the cell bake, a
material is a draw call in every block it appears in.

Draw calls went 533 to 894 and that is honest: more palms means palm materials
in more cells, and that is the price of the thing being asked for. Frame timings
across this session ranged from 19 ms to 2.6 ms for the *same* scene depending
on tab state and GPU clocking, so draw calls are the only number here worth
quoting.

## 45. La bomba

A wrecked patrol no longer recovers on a timer. It sits and smokes until a fire
truck routes to it along the grid, spends four seconds putting the fire out, and
sends the car back on shift. A wreck stopped being a number ticking down and
became something you can watch happen.

Two things had to be measured before it worked:

**One truck cannot keep up.** Baiting an aggressive shift into the kerb wrecked
**eight of nine** cars faster than the bomba could clear them, and the city was
left with no police at all. Wrecks are now capped at two at a time; past that a
patrol that would have binned it peels away instead.

**It was turning out from the wrong end of the island.** `farJunction` picks the
*furthest* junction, so every call was a 400 m drive and took 43 seconds. From a
station about 170 m out it is 11 s - long enough to see it coming, short enough
that you are not waiting on it.

## 46. Chumas, cuatrimotos, and ICE in Hummers

A tenth of the traffic on four-tracks and a tenth on scooters, both obeying the
same lane and the same collision box as a car - only the silhouette changes.

ICE turns up in big black wagons rather than patrol cars: squarer, taller, half
again as long, push bar and roof rack, strobes behind the screen instead of a
light bar. Which unit is coming has to be readable from the end of a street,
because it changes whether running is worth trying.

## 47. Los Piratas

Justin picked the rival riders off the list first and he was right to. The city
had traffic, police, pedestrians and dominoes in it and not one other person
doing the thing the game is about.

Seven riders on the same grid the police use, in the three bikes the player can
buy, with three temperaments: a hooligan who is up on the wheel constantly, a
racer who only does it flat out, and a learner who pops it for a second and puts
it down. They are up on the back wheel **37% of the time**, and coming alongside
one gets you their name and a shout.

Not a wheelie battle yet - no wagers, no scoring against them. First they have
to exist, have names, and be worth riding over to.

**They cost seven draw calls and 5,200 triangles across the whole crew**, all
passes counted, because they are a silhouette and not a second BikeView. Five
meshes each: paint, dark, kit, and a wheel at each end. The rider is in full
moto-X gear including a lid, which is what people wear here and also why no skin
material is needed.

Three things needed measuring, and a headless harness (`npm run rivals`) found
all three. It is in `npm run check` now.

**They were riding on the pavement.** The lane offset is 4.3 m right of the
centreline - between the traffic and the kerb, which is where you actually ride
past a line of cars and the only choice that leaves the whole middle of the road
to the player. But a waypoint counts as reached within three metres, and setting
off from wherever that was carries the error down the whole next block. Three
metres of drift is invisible on a patrol; with 4.3 m of lane offset on top it
put a wheel 7.2 m out. They now land exactly on the junction before setting off
from it, which costs a fifth of a second at a corner where the bike is turning
anyway. The harness fails the build if anyone gets past the kerb line.

**Seven riders turned out on five corners.** `av[(i * 2 + 1) % 5]` paired with
`st[(i * 3 + 2) % 5]` looks like it spreads them across twenty-five junctions
and does not: both indices are driven by `i mod 5`, so only five pairs exist.
Numbering the junctions and striding by 7 - coprime with 25 - uses all of them.
The police shift had the same bug for as long as it has existed.

**Every rider was leaning backwards.** Rotating about X by a positive angle tips
the top of a part toward +Z, which is forward, so leaning onto the tank is
`+lean`. Negating it sat them back off the bars like a deck chair, 23 degrees
the wrong way on the Ducati. Fourth time this project has been caught by an axis
sign, after the mirrors twice and the minimap.

One thing that only showed up in a screenshot: a helmet the same colour as the
jersey merges into a single blob at any distance. The lid is painted to match
the **bike** instead, which is how a kit is actually put together and costs
nothing, because the paint material is already in the bake.

## 48. The fence, and the ten hectares behind it

The edge of the map was five invisible boxes, and it leaked. You could ride out
of the plaza's opening to the sea, round the ends of the sea wall, and then all
the way round the **outside** of the city on ten hectares of blank grass - the
side walls stopped four metres past the plaza opening and nothing closed the
flanks.

A flood fill of the map found it in about a second. Riding to the corner of the
map would have found it too, eventually, and much worse. `tools/edgecheck` runs
that fill on every build now: it starts in the middle of the city, walks every
open cell, and fails if it reaches ground it should not.

Closing the leak with a taller invisible box would have fixed half of it. The
other half is that the edge of the map read as **nothing** - a field, and then a
wall you cannot see. So the boundary is a fence: chain link, barbed wire, posts
every six metres, and a braced double gate across every road that runs into it.
A street that ends at a locked gate is a place. A street that ends at nothing is
a bug.

Three things it taught:

**The wire is a texture, not geometry.** Two and a half kilometres of fence is
one alpha-tested quad per panel - two triangles - where modelled wire would be
tens of thousands. Alpha **test**, not blend, so there is nothing to sort and no
cost to having it in front of the whole city.

**A square texture on a panel that is not square gives stretched diamonds.** The
tile is drawn 1.2 x 2.6 to match the panel, so the diamonds come out square. And
the barbed wire had to be drawn heavy: at 2.4 px the strands aliased away at any
distance and the top fifth of the fence read as a gap above the mesh.

**There was a hole in the floor down every road.** The grass is laid as bands
between the road corridors, and the corridors are cut out of those bands in both
axes *everywhere* - including out in the apron where the road stopped long ago.
So every avenue left a six-metre slot of nothing running from the last junction
to the horizon, and you saw the sky dome through it. Standing at the south gate
it read as a pale blue river down the middle of the street. The roads now run
out to the fence and the grass fills what is past them.

## 49. 550 materials that were all the same material

Chasing the fence's cost turned up something much bigger: the city held **617
materials covering 67 distinct recipes**. 550 duplicates.

After the cell bake a cell costs one draw call per distinct material in it. Two
materials that are byte-for-byte identical but came from two different `new`
calls are not untidiness, they are two draw calls where there should be one. A
row of six buildings with a water tank on each was six identical navy materials
and six draw calls, in every cell, forever. There were 278 copies of one shutter
colour.

`view/materials.ts` shares them by recipe. **617 -> 78**, and with the fence
added on top the meshes in cull range fell by about a quarter:

| where | before | after |
| --- | --- | --- |
| spawn | 1363 | 988 |
| middle junction | 1980 | 1474 |
| plaza | 895 | 746 |
| against the fence | 770 | 553 |

This is the same fault the textures had, one level up: `makeShopSign` painted a
canvas per sign and handed three.js 180 uploads of one picture, `makeFacadeTexture`
cloned per wall for 232. Both were fixed by caching on what the thing *is*
rather than where it was asked for.

One thing must never come from the cache: anything animated at runtime. The
bomba's beacon is the same red at the same intensity as a patrol's light bar, so
through the cache they became **one object with two things writing to it** - the
fire truck's siren and every patrol's. `tools/vehiclecheck` asserts they are
different objects, which is how that got caught.

## 50. Every vehicle bakes now

The traffic car has been built as one mesh per material from the start - seven
draw calls whatever the part count. Nothing else was:

| | before | after |
| --- | --- | --- |
| cuatrimoto | 19 | 7 |
| chuma | 16 | 8 |
| patrol | 12 | 9 |
| ICE hummer | 23 | 6 |
| la bomba | 25 | 6 |

ICE puts **twelve** Hummers out. That was 276 draw calls of police in a frame
the whole city renders in about 530.

Baking also makes detail free, which is why this and the pass to make the
vehicles look better are the same change: once a vehicle is baked, another
mudguard or mirror in a material the model already uses costs triangles and
nothing else. The car got a raked windscreen and backlight, wing mirrors, a
grille and number plates for 288 triangles and no extra draw call. The plates
are in the *wheel* material rather than given a pale one of their own, because a
pale one would have been an eighth draw call on every car in the city.

The patrol's light-bar spine and door stripes now take the car's own dark
material instead of two near-blacks of their own - 0x1a1c22 and 0x14161c against
the car's 0x22242a. Nobody has ever seen that difference at 30 mph, and each one
was a whole extra draw call on every patrol.

Baked vehicles are cloned from a cached prototype, so the light bars have to be
found by name rather than held from the build. `npm run scene` checks every
vehicle against a draw-call budget and checks all seven animated lights survive
the bake and the clone - a rename would otherwise silently kill every siren.

## 51. The city was never painted San Juan

Justin's dad: "building colors look less like san juan."

The palette has twelve colours in it and the city can only afford a handful of
facade textures - one material each, and after the cell bake every material is a
draw call in every cell that uses it. **Which handful was decided by rolling
dice.** `makeFacadeTexture(i * 1637 + 13)` seeded the generator and took whatever
came out, and what came out was:

    lavender, teal, cream, teal again, mint, acid yellow

Five colours for a whole city, one of them twice. And between them not one of
the **sky blue, mustard, coral, terracotta or rose** that a street in Old San
Juan is actually painted - every one of those was in the palette and never once
got picked. The city read as generic Caribbean pastel because it was generic
Caribbean pastel.

They are named now: `SAN_JUAN_FACADES`, eight schemes, each with its own trim
and its own shutter colour - two facades with the same dark green doors read as
the same building twice down a street. Blue and teal at the cool end, mustard
through coral to terracotta at the warm, one rose, one cream. Deep green, navy,
oxblood and indigo doors against white trim, which is what all that ironwork
stands in front of.

Six was the budget when the city was submitting a thousand draw calls. Sharing
the materials by recipe (#49) took about a quarter off that, and two more
facades cost **8 meshes** in cull range - 1474 to 1482. Colour down a street is
most of what makes this place look like the place; it is the best thing that
budget could have been spent on.

The lesson is the one this project keeps relearning in different clothes: a
random pick out of a good list is not the same as a good pick. It was true of
the billboards that only ever showed one of two designs, and of the seven riders
who turned out on five corners.

## 52. What the console has to hold

"let's see how it looks on the xbox." Before handing it over, the numbers that
white-screened it last time, measured again:

    distinct geometries    2370   (3459 before the first Xbox fix, 1061 after)
    vertex + index memory  24.3 MB   (32 MB before, 9.6 MB after)
    distinct textures        23   (232 at the worst)

Textures were fine. **Geometry was at 24.3 MB against the 32 MB that killed it
before** - most of that from the map Justin asked to make bigger, not from any
one change, but it is the number that broke the console and it was creeping back
up. Two things were paying for nothing at all:

**Five megabytes of zeroes.** `bakeSubtree` gives every geometry in a bucket a
uv attribute so they all agree on their attributes - including buckets whose
material has no texture in it at all. Only 429 of 2330 buffers were mapped; the
other 1900 carried two floats per vertex of zeroes, uploaded and held for the
life of the scene. "All of them have none" is just as valid an agreement, and
free.

**Caps on cylinders nobody can see.** Ironwork was 7.3 MB and 137,000 triangles
- the single biggest block in the city, bigger than the buildings. A baluster's
top and bottom are inside the rails; a rail's ends are inside the posts; a palm
trunk is eight segments stacked into each other. Every one of those caps was
geometry that cannot be looked at. Open-ended cylinders, and a couple of sides
off the ones that were at twelve:

| | before | after |
| --- | --- | --- |
| ironwork | 7.3 MB / 137k tris | 2.4 MB / 71k |
| palm trunks | 3.2 MB / 92k tris | 1.6 MB / 73k |
| **whole city** | **24.3 MB** | **15.3 MB** |

37% off, and nothing looks different. Both of these had been there since long
before the map grew - the map growing is just what made them matter.

## 53. El Morro was standing on the city

Found while checking the above: riding up the middle avenue to the plaza, which
is the best view in the game, put a sixteen-metre **brown wall** across the
entire screen.

The headland is a 400 m box centred at x = -190, so it reached x = +10 - across
the middle avenue - and the cliff face under it was at z = 600, which is the top
cross street. The fort had been standing on the north end of the city since the
headland was built, and nobody had ridden up there to look.

Moved west and north of the sea wall. What is there now: the flag mural, la
monoestrellada on its pole, the road sign, the garitas, the domino tables, the
plaza opening out to the water, and El Morro on its own headland across it.

## 54. The console gets its own build

The tiers only ever changed how the scene was *drawn* - pixel ratio, shadows,
fog. The Xbox was building exactly the same city as a desktop and holding all of
it, on a machine with a hard memory ceiling it has already been over once.

    desktop   15.2 MB geometry + 22.9 MB textures = 38.1 MB
    xbox      10.6 MB geometry +  5.7 MB textures = 16.4 MB

**Textures were the bigger half and cost nothing to fix.** Every texture here is
512-ish square, and together they came to more than every vertex in the city.
`setTextureScale` halves them on the console: a texture is an area, so half the
size is a quarter of the memory, and at a pixel ratio of 1 on a television with
anisotropy already down at 2 there is nothing in that detail to see. `makeCanvas`
scales the canvas and pre-scales the context, so every generator keeps drawing in
its own coordinates and does not know it happened.

Geometry had to come out of the scenery: about half the balconies, awnings,
lamps, planters, people and parked cars, a third of the palms, one domino table
instead of three, and building shells without the filleted corners - three
segments puts a chamfer on every edge of every building, which is 96 triangles
apiece for something nobody gets near.

**The console must get the same city, not a different one.** The first cut
didn't: decoration drew from the same random sequence as the building sizes and
facade colours, so skipping a planter shifted every building after it and Justin
got a completely different street from the one on the desktop - same seed,
different city. `decorate` now runs on a generator seeded from where the building
stands, so what is ON a facade can never change WHICH buildings exist, and the
console cull is drawn from a third sequence that touches neither. Side by side
the two builds are the same street with fewer things on it.

`?tier=low` forces the console build on a desktop, which is the only way to see
what Justin sees without sitting in front of the Xbox. It has to be read in
`initialTier` because it changes what gets built, not just how it is drawn.

`npm run scene` now budgets the console build at 13 MB of geometry and fails
over it. The Xbox white-screened at about 32 MB and there is no reason to walk
back toward it.

## 55. Wheelie battles, and what "fair" has to mean

Justin's rules, near enough his words: a battle starts when you and a crew make
contact, a prompt comes up with the details and a yes/no, you each choose what
to bet, and **the AI suggests terms that are fair to both of you, taking your
request into consideration. Always fairly, no benefit to either party.**

That last line is the whole design, and the obvious reading of it is wrong.
"Fair" is not "you both put up the same money" - that is only fair between
equals, and Piraña has been doing this a great deal longer than you have. Fair
is **equal expected value**:

    yourStake x P(you win) === theirStake x P(they win)

so the favourite stakes more, in exact proportion to how much of a favourite
they are. Which gives the mechanic its shape for free: **beating somebody better
than you is how you get things cheaply.** Asking Piraña for the club kit when
you are 90% to win costs you $54,000 on the line. Asking for it when you are
10% to win costs $650. The odds are shown on the prompt, because the odds are
WHY the stakes are not equal and hiding them would make an honest bet look
rigged.

I had the formula upside down on the first pass - the underdog was staking more
- and it read completely plausibly. `npm run battles` caught it in a second by
checking the expected values rather than the algebra, and it now sweeps the
whole range of matchups and stakes and fails if the house ever leans either way.

Four challenges, because a wheelie is not one skill: longest single run in
metres, longest held in seconds, most runs over ten metres, and total ground
covered on the back wheel. The rival's score is **not rolled for them** - they
are out there riding and the battle watches what they actually do with the back
wheel, so you can see them earning it and the number at the end is true. They go
into race mode for the duration: a third of the rest between goes and half again
on the hold. Same rider, going for it.

## 56. Gear you cannot buy

Justin: "getting gear can only be done by winning in the wheelie races."

So the closet has three things in it and only one of them has a price. The
Piratas kit says **WIN IT — NOT FOR SALE**, and no amount of money moves it;
somebody has to lose it to you. La Monoestrellada is $100,000 as a placeholder
until we work out what it should really cost, because we agreed it should be his
and we have not decided how yet.

GARAGE and CLOSET are two buttons where the heading used to be - press one and
the other list goes away, which is exactly what he asked for.

The kit had to be visible from behind, or winning it means nothing: the chase
camera looks at the back of the rider's head for the entire ride, so that is
where the crew colours went. VQS over a white and light-blue striped flag, on
the back of the lid, which was his suggestion and is the right one.

Aura comes off the same odds: taking down a heavy favourite is worth five times
beating somebody you were always going to beat. It floors at nothing rather than
going negative - a reputation is something you have or have not got, and there
is no such thing as owing one.

## 57. Horses and chickens

Asked for, and not a joke: a paso fino tied up on the verge is an ordinary sight
here and so is having to go round one, and there are more chickens on this
island than there are people. The horses stand in the open middle of the blocks
and on the verges; a third of the chickens are in the road, which is the point -
a chicken on the centreline at forty miles an hour is a decision you have to
make. Both are baked the way the vehicles are: a horse is 1,508 triangles and
three draw calls, a chicken is 202 and three.

## 58. Winning should not crash you

Found while working out why the game had locked up in a live tab. The lock-up
was my own doing - a debug hook left installed in the browser that pinned the
bike onto Piraña and skipped the physics step, so the bike was welded inside
somebody, the speed could not leave zero, and the engine revved because the
throttle was being read while nothing advanced. It lived only in that tab's
memory and a reload cleared it. **Reload the tab when you have finished poking
at it.**

But next to it was a real one. The crew go non-solid for a battle, because you
spend a minute riding alongside them and being solid would make it a demolition
derby. They came back the instant the horn went - and you are very often
standing inside somebody at that moment, so winning handed you a crash you did
not cause.

This is the police bust loop wearing different clothes: respawning inside a
patrol, wrecking, respawning. That one took ten crashes in a row to notice. This
one gets a grace instead: nobody is an obstacle again until you have actually
ridden clear of them, and sitting on top of somebody holds the grace open rather
than letting the clock run out underneath you. `npm run rivals` parks the bike
on a rider for four seconds after a race and fails if they solidify, and checks
they do come back once you ride away - a grace that never expires would be a
different bug.

## 59. Our ports are 417x

"when I go to 5173 I see the Save to Make app" - and he did.

5173 is Vite's default, so every Vite project on the machine wants it.
Save'n'Make's dev server had been on it since 08:48. A wheelie-life dev server
started at 09:18 and **also** bound to 5173, because the two ended up on
different stacks: Save'n'Make on `[::1]:5173`, ours on `*:5173`. macOS resolves
`localhost` to `::1` first, so going to :5173 for the game served the other app.
Neither server complained. Nothing in either log said a word.

This is the third time ports have cost an afternoon here - "how can it play on
4173 and 5173 and I'm still on 708d4ad", then "should I be testing on 4 or
5173". So they are ours now and they are next to each other:

    4173   npm run beta    the built game — what gets tested before a deploy
    4174   npm run dev     hot reload while working

`strictPort` turns a clash into a startup failure you can read, instead of a
wrong page you have to happen to notice. `host: '0.0.0.0'` binds every interface
rather than IPv6 loopback only, which is separately what stopped Safari loading
localhost at all a while back - same root cause, different symptom.

## 60. Reverse could not steer

`smoothstep(0, 1.2, s.speed)` gated the steering authority on **forward** speed,
so the moment the velocity went negative the whole term became zero. Paddling
backwards was a straight line, and the only way out of a corner you had nosed
into was to crash on purpose.

Everything in that block works off the magnitude now, and the direction falls
out of the sign of the velocity rather than being a special case - the same bars
swing the tail the other way, exactly like backing a car. Reverse gets 45% of
the normal yaw rate, which is about fifty degrees a second: enough to point the
bike somewhere useful in a couple of seconds, not enough to pirouette at walking
pace. Using the magnitude also removed a divide-by-zero in `speedFactor` that
would have detonated at exactly `-yawSpeedFalloff`.

`npm run sim:all` now backs each bike up for four seconds on full lock and fails
if it does not turn, or if left and right turn the same way.

## 61. The crew is Justin's

His rules, and they are good ones because they need no explaining: **one rider
per 100 aura, four at the most, and the number of riders is the crew's level.**
A level three crew is three riders. There is nothing else to say about it.

The size is derived from the aura rather than stored, because two numbers that
must agree are one number waiting to disagree.

He names it, picks one of eight colours and one of six shapes, and it goes on
the back of his helmet - over the top of whatever kit he is wearing, because
once he has a crew it is his lid. The badge in the menu paints the **actual
plate**, the same canvas that textures the helmet, rather than an approximation:
otherwise the shape he picks is invisible until he has ridden off in it, which
is a poor way to choose one.

The name shrinks to fit rather than being sized off the letter count. A guess is
fine for LOS PIRATAS and runs off both ends of the plate for LOS TIBURONES, and
the entire point is that he can call it whatever he likes.

## 62. La Monoestrellada, and what it costs

$100,000 was a placeholder because we had not decided. The answer: **money has
nothing to do with it.** Take a wheelie battle off every single one of Los
Piratas - all seven - and it turns up in the closet. It is the only thing in the
game that cannot be shortcut. You can buy a Ducati; you cannot buy this.

Black head to foot with gold as the only other colour, and one gold star. Every
other outfit has at least two colours fighting each other; this one has one, and
that is what makes it read as the special thing from across a junction rather
than as another kit. The closet shows the count - "3/7 PIRATAS BEATEN" - because
a locked thing with no visible progress is just a locked thing.

## 63. Lights and limits, and hardly any of them

"we can do lights and limits but make it super rare atm." Three lights and three
signs in the whole city. A light every few hundred metres is a landmark and
something to time a run against; one on every corner is a chore, twenty-five
more masts to draw, and a reason to stop wheelieing every hundred metres.

They cycle, and they are deliberately not synchronised with each other - a city
where every light changes together reads as a machine rather than a place.
Nothing enforces them yet. Whether running a red should raise heat is a decision
for when there is a reason to make it.
