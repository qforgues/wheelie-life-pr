# WHEELIE LIFE PR ♛

**Calles · Bikes · Isla · Libertad**

First playable prototype. A Grom, a cobbled street in Old San Juan, and honest
wheelie physics.

```bash
npm install
npm run dev      # http://localhost:5173
```

---

## Controls

Built for a DualSense first. Plug one in and it's picked up automatically —
keyboard is the desktop fallback. Press **H** in game for the same table.

| | PS5 | Keyboard |
|---|---|---|
| Throttle | **R2** | `W` / `↑` |
| Brake | **L2** | `S` / `↓` |
| Steer | **Left stick ← →** | `A` `D` / `←` `→` |
| Pull back — lift the front | **Left stick ↓** | `Space` |
| Lean forward — bring it down | **Left stick ↑** | `Shift` |
| Shift up | **R1** | `E` |
| Shift down | **L1** | `Q` |
| Camera | **Right stick** | drag the mouse |
| Reset | **Options** / **○** | `R` |
| Controls card | **Create** | `H` |
| Tuning panel | — | `P` |
| Mute | — | `M` |

### How to ride it

1. **Get it up.** 1st or 2nd gear, pin the throttle and pull back at the same
   time. The pull is a *snap*, not a lean — it's your body weight going back.
2. **Hold it.** Ride the throttle. The balance point is around 40°, and it drops
   as you sit further back. There is no meter for it, on purpose — you'll learn
   it from the horizon, the engine note and the rumble.
3. **Save it.** Gone too far? A stab of brake goes entirely to the rear wheel and
   pulls the nose down. If you can hear the tail scraping, you have about a
   heartbeat.
4. **Keep it going.** You can't lift it in 3rd, but you *can* shift into 3rd and
   4th while you're already up. An upshift cuts the torque and drops the nose
   ~4.5°, so feed the pull-back through it. That's the whole game.
5. **Use the bumps.** Three speed bumps on the avenue. Time a pull-back over one
   and you get a free lift — it's the only way into a 3rd-gear wheelie.

---

## What's in it

- One slice of an Old San Juan-style barrio: a 490 m cobbled avenue, two cross
  streets, a plaza overlook, El Morro on the headland. Midday, clear.
- A Grom with a big-bore kit, 5-speed manual, modelled from real geometry.
- Wheelie distance, best and last. Speed, gear, tacho.
- Synthesised engine audio, tail-scrape audio, controller rumble.
- A live tuning panel (`P`) with everything that defines the feel.

Not in yet, by design: traffic, police, night, weather, missions, other bikes.

---

## Layout

```
src/
  sim/          the bike. no Three.js, no DOM, no browser.
    tuning.ts     every physical constant, in one file
    BikeSim.ts    pitch / longitudinal / roll integration
    Engine.ts     torque curve
    Gearbox.ts    5-speed, clutchless shifts with a torque cut
    types.ts      RiderInput in, BikeState out
  input/        gamepad + keyboard -> one RiderInput
  world/        procedural city, textures, sky, props
  view/         procedural bike + rider mesh, chase camera
  audio/        WebAudio engine synthesis
  ui/           HUD, controls card, tuning panel
  game/         wiring, scoring
  core/         fixed-timestep loop
tools/
  simcheck.ts   headless physics harness
```

`src/sim/` is deliberately sealed off from everything else — see
[`docs/DECISIONS.md`](docs/DECISIONS.md) §9 for why, and what it means for the
eventual console port.

---

## Tuning it

Press **P**. Every number that shapes the feel is in there and applies live —
engine, chassis, CG position, rider weight shift, brakes, balance, camera. Three
presets: **Chill** (no side-to-side wobble, wider save window), **Real**, and
**Stunt**.

Found a setup you like? Hit **Copy tuning JSON** and paste it into
`src/sim/tuning.ts`.

## Checking the physics

```bash
npm run sim
```

Runs the bike headless and reports acceleration, which gears can lift, whether
mashing the throttle loops you, whether the brake can save it, how far a well-
ridden wheelie goes, and what an upshift does to the nose. Run it after any
change to `sim/`.

```
LOFT TEST (roll into each gear at mid-range, then pin it + pull back)
  gear 1 (16 mph, 5231 rpm)          82° — LOOPS if you hold it
  gear 2 (29 mph, 6141 rpm)          82° — LOOPS if you hold it
  gear 3 (43 mph, 6778 rpm)           3° — stays down
  ...
HELD WHEELIE (autopilot riding just under the balance point)
  distance                           259.1 m
  duration                           21.1 s
  top gear reached                   4
```

## Other commands

```bash
npm run build       # production build -> dist/
npm run preview     # serve the production build
npm run typecheck
```
