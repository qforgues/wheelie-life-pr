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

Built for an Xbox controller. Plug one in and it's picked up automatically —
keyboard is the desktop fallback. Press **View** (or **H**) in game for the same
table.

| | Xbox | Keyboard |
|---|---|---|
| Throttle | **RT** | `W` / `↑` |
| Brake | **LT** | `S` / `↓` |
| Steer | **Left stick ← →** | `A` `D` / `←` `→` |
| Pull back — lift the front | **Left stick ↓** | `Space` |
| Lean forward — bring it down | **Left stick ↑** | `Shift` |
| Shift up | **RB** | `E` |
| Shift down | **LB** | `Q` |
| Camera | **Right stick** | drag the mouse |
| Reset | **Menu** / **B** | `R` |
| Controls card | **View** | `H` |
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

## Voices

Crash calls run through three tiers, in this order:

1. **A real recording**, if one has been made.
2. **The browser's speech synthesis**, if it has a voice.
3. **Silence.**

Only the first is any good. Speech synthesis was always a stand-in — it cannot
be captured or shipped, it sounds like a satnav, and the Xbox browser may have
no voices at all. It exists so the channel works before anyone has recorded
anything.

### Recording the lines

Open **`/record.html`** on the live site (or `localhost:5173/record.html`) on a
laptop or phone. It walks through each line, records it, plays it back, and
downloads the files named the way the game expects, plus a `manifest.json`.

Drop everything into `public/voice/` and rebuild. That's it — the loader reads
the manifest and decodes whatever is there.

**Any audio format works.** `decodeAudioData` handles mp3, m4a, wav, ogg and
webm, so a phone voice memo can be dropped straight in with no conversion. That
matters more than picking one format: the people recording these are a kid and
his dad, not a studio. The recorder itself saves whatever the browser produces —
`.m4a` on Safari and iOS, `.webm` on Chromium — because `MediaRecorder` cannot
emit mp3 without shipping an encoder, and there is no playback benefit to it.

`public/voice/manifest.json` maps crash reasons to files:

```json
{ "lines": { "looped": ["looped-1.m4a", "looped-2.m4a"] } }
```

Several files under one reason means the game picks between them at random.
A missing manifest is the normal state until someone records, so it 404s
quietly and the game falls through to tier two.

This is the groundwork for the rival trash talk the interview asks for, in
English or Puerto Rican Spanish — the same loader, with more lines.

## Other commands

```bash
npm run build       # production build -> dist/
npm run preview     # serve the production build
npm run typecheck
```

---

## Environments

| | Where | Notes |
|---|---|---|
| **Beta** | `npm run dev` → `localhost:5173` | Hot reload, tuning panel, full quality |
| **Live** | https://wheelie-life-pr.quentin-forgues.workers.dev | Cloudflare Workers static assets. This is the URL the Xbox loads. |

```bash
npm run check     # typecheck + build + physics harness on every bike
npm run deploy    # runs check, then ships to live
```

`deploy` will not ship if the health check fails.

### Playing it on Xbox

Xbox is the only console target. Microsoft Edge is a free, installable app on
Xbox One and Series X|S and can browse to any URL, so this build runs there
as-is.

To play:

1. Open **Edge** on the Xbox (install it from the Store if it isn't there).
2. Go to the live URL above.
3. Pick a bike on the start card, then press **RIDE**.

**The controller input mode has to follow the menu.** `navigator.gamepadInput\
Emulation` decides whether the console's browser drives its own cursor or hands
raw Gamepad API input to the page:

- **Start card up → `mouse`.** The controller works the card, and pressing RIDE
  is a real user gesture — which is the only thing that can unlock the audio
  context, since gamepad input is not a user activation in Chromium.
- **Riding → `gamepad`.** The page gets the sticks and triggers directly.

Setting `gamepad` once at startup, which is the obvious thing to do, breaks the
console completely: there is no pointer, so the bike picker and the RIDE button
become unreachable and audio can never start.

Console-specific handling:

- **TV overscan.** Anything within ~5% of a TV's panel edge can be cut off, and
  the browser gives no way to detect it. Console builds pull the HUD inside a
  safe margin and scale the type up for couch viewing distance.
- **Quality.** Console browsers start one tier down and drop further on their
  own if the frame rate can't hold. See `src/core/Quality.ts`.
- **No rumble.** The Gamepad haptics API isn't available in the Xbox browser, so
  the balance rumble channel is desktop-only there.
- **Diagnostics.** **D-pad up**, or the button on the start card, shows what the
  page actually got: renderer, gamepad id, input mode, audio state, frame rate,
  and live stick and trigger values. It also opens itself on an uncaught error.
  This is the only way to see what a console is doing without a devtools window.
