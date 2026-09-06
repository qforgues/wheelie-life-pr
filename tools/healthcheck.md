# Health check

`npm run check` runs the three gates before any change ships:

1. **`typecheck`** — strict TS, no unused locals or params.
2. **`build`** — the production bundle actually compiles.
3. **`sim:all`** — the headless physics harness against *every* bike in the
   catalogue. This is the one that catches feel regressions: if a tuning edit
   makes a bike unable to loft, unable to save a wheelie, or turns roll from a
   lean back into a fall, it shows up here rather than in Justin's hands.

What each harness section is asserting:

| Section | Should say |
|---|---|
| ACCELERATION | numbers in the region of the real bike |
| LOFT TEST | at least one gear lofts; top gear does not |
| LOOP TEST | mashing throttle + pull-back loops you |
| BRAKE SAVE | `SAVED` |
| HELD WHEELIE | hundreds of metres, ends `still up` |
| UPSHIFT | `the shift is felt` |
| SPEED BUMP | pulling back over one beats riding over it |
| ROLL | `leans RIGHT`, 0 lowsides, `recoverable` |

The browser side is checked by hand: load it, ride, and watch the console. The
things that have actually broken before are the render loop (judder), the rider
IK (limbs detaching), and draw-call count after adding scenery.
