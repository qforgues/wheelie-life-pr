# Wheelie Life PR — working notes for Claude

**Justin is in charge of this game.** He is nine, he designed it, and every
feature in it came out of his head — the wheelie battles, the crew, the police
ladder, ICE in black Hummers, horses and chickens in the road. He is the client
and the designer. Build what he asks for, tell him what you did in plain words,
and when something is a bad idea say so once and then do it his way if he still
wants it.

Talk to him like a colleague, not a teacher. Short sentences, no lectures, no
"great question!". If you have to explain something technical, explain it with
what it means for the game — "that would drop the frame rate on your Xbox", not
"that increases the draw-call count".

---

## First run on a new machine

```bash
git clone https://github.com/qforgues/wheelie-life-pr.git
cd wheelie-life-pr
npm install
npm run beta          # http://localhost:4173
```

Needs Node 22 or newer (`node -v`).

**Ports are ours and they are fixed.** 5173 is Vite's default and every project
on a machine fights over it — Justin's dad once spent an afternoon looking at a
different app because two servers had bound the same port on different network
stacks. So:

| port | command | what it is |
|---|---|---|
| **4173** | `npm run beta` | the built game — what gets tested before a deploy |
| **4174** | `npm run dev` | hot reload while working |

Both are `strictPort`, so a clash is a startup failure you can read instead of a
wrong page you have to notice.

`npm run beta` is safe to run twice: if something is already serving 4173 it
says so and exits.

### Deploying

`npm run deploy:live` publishes to Cloudflare and needs **Quentin's Cloudflare
login** — Justin will not have it on his Mac. That is fine and mostly does not
matter: everything can be built, tested and played on `localhost:4173`. When
something is ready to go live, ask Quentin to run the deploy, or ask him to log
wrangler in on Justin's machine.

`npm run deploy` refuses on purpose. Live is a deliberate act.

---

## The rules

**1. `npm run check` before anything ships.** It is the gate and it is not
optional. It runs:

| | what it proves |
|---|---|
| `typecheck` | strict TS, no unused anything |
| `build` | the bundle actually compiles |
| `sim:all` | the physics, on all three bikes, headless |
| `rivals` | Los Piratas stay on the road and actually wheelie |
| `scene` | every vehicle is within its draw-call budget, every siren still flashes |
| `edges` | you cannot get out of the map |
| `battles` | the wager broker does not favour either side |

Each of those harnesses exists because something broke. Do not delete one to
make a change pass — that is the harness doing its job.

**2. Measure, do not guess.** This project has been wrong about a lot of things
that felt obvious:

- The wager formula was inverted — the *underdog* was staking more — and it read
  perfectly plausibly. Checking expected values rather than the algebra caught it
  in a second.
- Frame timings are useless here: the same scene measured 19 ms, 7 ms and 2.6 ms
  depending on whether the tab was focused. **Quote draw calls, not frame times.**
- Three separate coordinate bugs (mirrors twice, minimap once) were only ever
  settled by probing actual pixels.

If you are about to say "this should be faster now", measure it instead.

**3. Localhost first.** Changes go to `localhost:4173` and stay there until
Justin has looked at them and said yes. When a build does go live, the running
game raises an **UPDATE READY** chip rather than reloading underneath whoever is
playing.

**4. Comments explain *why*.** The code says what it does. A comment earns its
place by recording the thing that is not obvious — usually the bug that made the
line necessary. Read a few in `src/world/City.ts` for the register.

**5. `src/sim/` never imports Three.js or touches the DOM.** The physics is
tested headlessly and that is what keeps it honest. `tools/simcheck.ts` failing
to bundle means something rendering-related leaked in.

---

## The Xbox

Justin plays on an Xbox. It is the hardest constraint in the project and it has
broken twice.

**It has a hard GPU memory ceiling.** Distance culling hides geometry but does
**not** free it — once a buffer has been drawn it stays resident, so riding
around used to upload the whole city cumulatively until the WebGL context died.
The symptom is a white screen with a working HUD over it, or buildings and roads
turning black as texture uploads start failing.

What is in place now:

- A **separate console build** (`new City(true)`): about half the balconies,
  awnings, lamps, planters, people and parked cars, fewer palms, simpler
  building shells — and **half-size textures**, which is a quarter of the
  texture memory and the single biggest saving of the lot.
- **No post-processing on the console.** Bloom needs a full-screen buffer, which
  is 8 MB at 1080p before its own mip chain. It keeps the colour grade, which is
  free, and the low sun. That is most of the look for none of the memory.
- **The console tells us it failed rather than us guessing.** Sniffing the user
  agent for "xbox" did not match Justin's console — it reports itself as
  `desktop / other` — so it was handed the full desktop build for weeks. Losing
  the WebGL context now writes `low` to localStorage, frees the post chain, and
  reloads a lighter build. A machine only has to fail once.
- `?tier=low` on the URL forces the console build on any machine, which is how
  you see what Justin sees without sitting in front of the TV.

**The diagnostics panel is the debugging tool for that machine.** D-pad up in
game. The four lines that matter are `device`, `fps`, `quality` and `scene`.
Ask for a photo of it before theorising.

Budgets, enforced by `npm run scene`: **13 MB of geometry** on the console build,
and each vehicle within a few draw calls.

---

## Where things live

```
src/sim/        physics — no Three.js, no DOM, tested headless
src/world/      the city, traffic, police, rivals, props, textures
src/view/       the bike model, mirrors, camera, materials, post-processing
src/game/       Game loop, progress/save, upgrades, outfits, battles, crew
src/ui/         HUD, menu, minimap, battle card, diagnostics
src/core/       renderer guard, quality tiers, update watcher
tools/          every harness, plus the release script
docs/DECISIONS.md   why the game is the way it is — 70+ entries
```

`docs/DECISIONS.md` is the memory of this project. When you fix something
non-obvious, add an entry. When you are about to change something and cannot
see why it is that way, look there first — the answer is usually in it.

---

## Justin's list

Things only he can do:

- **Record the crash shouts** at `/record.html` — the page is built and waiting.
- **Name the seven rivals** and say who they are. They are placeholders
  (PIRAÑA, LA SOMBRA, TITO, CHUCHÍN, MELO, NENA, EL FLACO) in one array in
  `src/world/Rivals.ts`.
- **Write the trash talk.**
- **Name his crew**, pick its colour and shape — in the menu, and it goes on the
  back of his helmet.

## What is next

In roughly the order it was last agreed:

1. **Crew riders on the street.** The crew level is a number and a badge today.
   Putting those riders out there beside him — and eventually swapping them off
   Los Piratas — is the obvious next move, and the aura is already banking for it.
2. **Ambient occlusion.** Nothing is darker where it meets anything else, so
   everything faintly floats. The next big "placed in the world" cue.
3. **Surface detail** — one shared detail-normal map, roughness variation, road
   decals. The phase that actually costs memory, so the console build has to be
   thought about first.
4. Game modes menu, fuel, more of the island.
5. Online / split-screen, which is the big one and the right thing to do last.

---

## One more thing

Two of the worst bugs in this project were mine, not the code's: a debug hook
left running in Quentin's browser that welded his bike to a rival, and a preview
server killed before a deploy and never restarted. **Clean up after yourself in
someone else's environment.** If you reach into a live page to test something,
reload it when you are done.
