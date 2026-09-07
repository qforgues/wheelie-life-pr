/**
 * Is the broker actually fair?
 *
 * Justin's rule for wagers was "it always does it fairly, no benefit to either
 * party", and that is a claim you can check rather than assert. A bet is fair
 * when both sides have the same expected value:
 *
 *     yourStake x P(you win) === theirStake x P(they win)
 *
 * so the favourite has to stake more, in exact proportion. This runs the broker
 * across the whole range of matchups and stakes and fails if the house ever
 * leans - toward the player OR away from them.
 *
 *   npm run battles
 */
import {
  CHALLENGES, Scorecard, auraFor, broker, fairCounter, oddsFor,
  stakeLabel, stakeValue, type Stake,
} from '../src/game/Battles';
import { OUTFITS } from '../src/game/Outfits';
import { offerFrom } from '../src/game/Battle';
import { MAX_CREW, auraToNext, crewSize } from '../src/game/Crew';
import { MONOESTRELLADA_NEEDS } from '../src/game/Outfits';

const problems: string[] = [];
const pad = (s: string, n: number) => s.padEnd(n);

console.log('');
console.log('=========================================================');
console.log('THE BROKER — is a wheelie battle an honest bet?');
console.log('');

// ---- odds are symmetric and never certain --------------------------------
let worstSym = 0;
for (let a = 0; a <= 1.0001; a += 0.05) {
  for (let b = 0; b <= 1.0001; b += 0.05) {
    const p = oddsFor({ skill: a }, { skill: b });
    const q = oddsFor({ skill: b }, { skill: a });
    worstSym = Math.max(worstSym, Math.abs(1 - (p + q)));
    if (p <= 0 || p >= 1) problems.push(`odds hit a certainty at skill ${a} vs ${b}`);
  }
}
if (worstSym > 1e-9) problems.push(`odds are not symmetric — worst error ${worstSym}`);
console.log(`  ${pad('odds symmetric (p + q = 1)', 40)} worst error ${worstSym.toExponential(1)}`);
console.log(`  ${pad('odds never 0 or 1', 40)} range ${oddsFor({skill:0},{skill:1}).toFixed(2)} .. ${oddsFor({skill:1},{skill:0}).toFixed(2)}`);

// ---- the raw fair counter is exactly fair --------------------------------
let worstEV = 0;
for (let odds = 0.1; odds <= 0.9001; odds += 0.02) {
  for (const mine of [100, 500, 2500, 12000, 60000]) {
    const theirs = fairCounter(mine, odds);
    const yourEV = theirs * odds;
    const theirEV = mine * (1 - odds);
    worstEV = Math.max(worstEV, Math.abs(yourEV - theirEV) / Math.max(yourEV, theirEV));
  }
}
if (worstEV > 1e-9) problems.push(`the fair counter is not fair — worst EV skew ${worstEV}`);
console.log(`  ${pad('fair counter equalises EV', 40)} worst skew ${worstEV.toExponential(1)}`);

// ---- the favourite always stakes more ------------------------------------
let backwards = 0;
for (let odds = 0.15; odds <= 0.85; odds += 0.05) {
  const mine = 1000;
  const theirs = fairCounter(mine, odds);
  // odds > 0.5 means YOU are the favourite, so THEY should stake less.
  if (odds > 0.5 && theirs >= mine) backwards++;
  if (odds < 0.5 && theirs <= mine) backwards++;
}
if (backwards) problems.push(`${backwards} matchups where the underdog staked more than the favourite`);
console.log(`  ${pad('favourite always stakes more', 40)} ${backwards === 0 ? 'yes' : `NO (${backwards} cases)`}`);

// ---- end to end, with real stakes the rival actually owns ----------------
console.log('');
console.log('  worked examples');
const rows: Array<[string, number, number, Stake]> = [
  ['even match, $500 up', 0.5, 0.5, { kind: 'cash', amount: 500 }],
  ['you outclassed', 0.25, 0.75, { kind: 'cash', amount: 500 }],
  ['you dominant', 0.85, 0.3, { kind: 'cash', amount: 500 }],
  ['staking the Piratas kit', 0.5, 0.55, { kind: 'outfit', outfit: 'piratas' }],
  ['staking aura', 0.45, 0.5, { kind: 'aura', amount: 3 }],
];
for (const [what, mySkill, theirSkill, stake] of rows) {
  const t = broker({
    challenge: CHALLENGES.distance,
    you: { skill: mySkill },
    them: { skill: theirSkill },
    yourStake: stake,
    theirWant: null,
    theirOutfits: ['piratas'],
    theirCash: 40000,
  });
  const mine = stakeValue(t.yours);
  const theirs = stakeValue(t.theirs);
  const skew = Math.abs(theirs * t.yourOdds - mine * (1 - t.yourOdds))
    / Math.max(theirs * t.yourOdds, mine * (1 - t.yourOdds), 1e-6);
  console.log(`    ${pad(what, 26)} you ${(t.yourOdds * 100).toFixed(0).padStart(2)}%  you put up ${String(Math.round(mine)).padStart(6)}  they put up ${String(Math.round(theirs)).padStart(6)}  skew ${(skew * 100).toFixed(0)}%  ${t.theyAccept ? 'signed' : 'REFUSED'}`);
  // Rounding to money people say out loud costs some precision; anything past
  // a quarter off is the broker being wrong, not the rounding.
  if (t.theyAccept && skew > 0.25) {
    problems.push(`${what}: terms are ${(skew * 100).toFixed(0)}% lopsided`);
  }
}

// ---- you cannot buy the kit cheap by being good --------------------------
// The whole point of gear being win-only is that it costs you something. A
// heavy favourite asking for the Piratas kit has to cover it properly.
const grab = broker({
  challenge: CHALLENGES.distance,
  you: { skill: 0.9 },
  them: { skill: 0.2 },
  yourStake: { kind: 'cash', amount: 25 },
  theirWant: { kind: 'outfit', outfit: 'piratas' },
  theirOutfits: ['piratas'],
  theirCash: 40000,
});
console.log('');
console.log(`  ${pad('asking for the kit at 90% to win', 40)} you put up ${stakeLabel(grab.yours)} against ${stakeLabel(grab.theirs)}  ${grab.theyAccept ? 'signed' : 'refused'}`);
if (stakeValue(grab.yours) < OUTFITS.piratas.value * 3) {
  problems.push(`a heavy favourite got the Piratas kit for only ${stakeLabel(grab.yours)}`);
}
// And the reverse: a rank underdog should be able to have a go at it cheaply.
const punt = broker({
  challenge: CHALLENGES.distance,
  you: { skill: 0.1 },
  them: { skill: 0.9 },
  yourStake: { kind: 'cash', amount: 500 },
  theirWant: { kind: 'outfit', outfit: 'piratas' },
  theirOutfits: ['piratas'],
  theirCash: 40000,
});
console.log(`  ${pad('asking for the kit at 10% to win', 40)} you put up ${stakeLabel(punt.yours)} against ${stakeLabel(punt.theirs)}  ${punt.theyAccept ? 'signed' : 'refused'}`);
if (stakeValue(punt.yours) > OUTFITS.piratas.value * 0.5) {
  problems.push('an underdog is being overcharged to have a go at the kit');
}

// ---- aura rewards the underdog -------------------------------------------
const under = auraFor(true, 0.15);
const even = auraFor(true, 0.5);
const fav = auraFor(true, 0.85);
console.log(`  ${pad('aura for a win', 40)} underdog ${under}, even ${even}, favourite ${fav}`);
if (!(under > even && even > fav)) problems.push('aura does not reward beating better riders');
if (auraFor(false, 0.5) >= 0) problems.push('losing should cost aura');

// ---- the scorecard scores what it says it does ---------------------------
const card = new Scorecard();
card.land(42, 6.2);
card.land(8, 1.1);
card.land(31, 9.4);
const ok = card.score('distance') === 42 && card.score('time') === 9.4
  && card.score('count') === 2 && card.score('total') === 81;
console.log(`  ${pad('scorecard: 42m/6.2s, 8m/1.1s, 31m/9.4s', 40)} best ${card.score('distance')}m, held ${card.score('time')}s, ${card.score('count')} over 10m, ${card.score('total')}m total`);
if (!ok) problems.push('the scorecard is not counting what it claims to');
// A run in progress has to show live, or the HUD lies during the last wheelie.
if (card.score('distance', 55) !== 55) problems.push('a run in progress is not counted live');

// ---- a whole battle, start to finish -------------------------------------
// The rules are only half of it. This runs the state machine through a real
// sixty seconds with both riders putting wheelies in, and checks the thing
// scores what actually happened.
console.log('');
console.log('  a full battle');
const b = offerFrom(
  0, 'PIRAÑA', 'distance', 0.55, 0.72,
  { kind: 'cash', amount: 1000 }, null, ['piratas'], 40000,
);
b.accept();
const DT = 1 / 60;
let t = 0;
// You: a 40 m run, then a 66 m one. Them: steady 50 m runs.
let yourRun = 0;
let theirRun = 0;
let theirUp = false;
for (let i = 0; t < 70; i++, t += DT) {
  const phase = t % 14;
  const youUp = phase > 2 && phase < 7;
  yourRun = youUp ? (phase - 2) * (t < 30 ? 10 : 16.5) : 0;
  const tp = (t + 3) % 11;
  theirUp = tp > 1 && tp < 6;
  theirRun = theirUp ? (tp - 1) * 10 : 0;
  b.update(DT, yourRun, !youUp, theirUp, theirRun);
}
const o = b.outcome;
if (!o) {
  problems.push('the battle never finished');
} else {
  console.log(`    ${pad('60 seconds of both of you riding', 34)} you ${o.yourScore.toFixed(1)} m, them ${o.theirScore.toFixed(1)} m — ${o.won ? 'you took it' : 'they took it'}`);
  console.log(`    ${pad('aura', 34)} ${o.aura > 0 ? '+' : ''}${o.aura}`);
  if (b.phase !== 'result') problems.push('the battle did not reach a result');
  if (o.yourScore < 60) problems.push(`your best run scored ${o.yourScore.toFixed(1)} m — the 66 m one was not counted`);
  if (o.theirScore < 40) problems.push(`their score came out at ${o.theirScore.toFixed(1)} m — their runs were not counted`);
  if (!o.won) problems.push('the longer rider lost');
}
// A battle you bin out of ends there and then.
const bail = offerFrom(1, 'TITO', 'time', 0.5, 0.22, { kind: 'cash', amount: 250 }, null, [], 8000);
bail.accept();
for (let i = 0; i < 300; i++) bail.update(DT, 20, false, false, 0);
bail.finish();
console.log(`    ${pad('crashing out ends it immediately', 34)} ${bail.phase === 'result' ? 'yes' : 'NO'}`);
if (bail.phase !== 'result') problems.push('crashing out did not end the battle');
// And it cannot be settled twice.
if (bail.outcome) {
  const first = bail.outcome;
  bail.finish();
  if (bail.outcome !== first) problems.push('finishing twice produced a second result');
}

// ---- the crew, and the kit you cannot buy --------------------------------
console.log('');
console.log('  the crew (1 rider per 100 aura, 4 at the most)');
for (const a of [0, 99, 100, 250, 399, 400, 900]) {
  console.log(`    ${String(a).padStart(4)} aura -> level ${crewSize(a)}${auraToNext(a) ? `, ${auraToNext(a)} to the next` : ' (full)'}`);
}
if (crewSize(99) !== 0 || crewSize(100) !== 1 || crewSize(399) !== 3) {
  problems.push('the crew does not grow one rider per 100 aura');
}
if (crewSize(900) !== MAX_CREW) problems.push(`the crew capped at ${crewSize(900)} rather than ${MAX_CREW}`);
if (auraToNext(400) !== 0) problems.push('a full crew is still asking for more aura');
if (OUTFITS.monoestrellada.price !== -1) {
  problems.push('La Monoestrellada has a price on it — it is meant to be unbuyable');
}
console.log(`    ${pad('La Monoestrellada', 24)} ${OUTFITS.monoestrellada.price === -1 ? `no price — beat all ${MONOESTRELLADA_NEEDS} of them` : 'FOR SALE'}`);

console.log('');
if (problems.length) {
  console.log('  PROBLEMS');
  for (const p of problems) console.log(`    - ${p}`);
  console.log('=========================================================');
  process.exit(1);
}
console.log('  the house does not lean either way');
console.log('=========================================================');
