import { OUTFITS, type OutfitId } from './Outfits';

/**
 * Wheelie battles.
 *
 * Justin's rules, in his words: a battle starts when you and a crew **make
 * contact**. Then there is a prompt with the details and a yes/no. You each
 * choose what to bet, the broker suggests terms that are fair to both, and
 * either of you can walk.
 *
 * The bit that makes it work is what "fair" means. It is NOT "you both put up
 * the same money" - that is only fair between equals, and Piraña has been doing
 * this a lot longer than you have. Fair here is **equal expected value**: the
 * broker works out who is more likely to win, and the favourite has to stake
 * more. Which means beating somebody better than you pays properly, and beating
 * Tito on the Grom does not.
 *
 * Nothing in here knows about Three.js or the DOM. It is the rules, and it is
 * tested headlessly the way the physics is.
 */

export type ChallengeId = 'distance' | 'time' | 'count' | 'total';

export interface Challenge {
  id: ChallengeId;
  /** Shown on the prompt. */
  name: string;
  /** One line telling you what you actually have to do. */
  brief: string;
  /** How long the two of you have. */
  seconds: number;
  /** Formats a score for the HUD. */
  format: (v: number) => string;
}

export const CHALLENGES: Record<ChallengeId, Challenge> = {
  distance: {
    id: 'distance',
    name: 'LONGEST ONE',
    brief: 'Longest single wheelie, in metres. One big one beats ten small ones.',
    seconds: 60,
    format: (v) => `${v.toFixed(1)} m`,
  },
  time: {
    id: 'time',
    name: 'LONGEST HELD',
    brief: 'Longest single wheelie, in seconds. Slow it down and hold it.',
    seconds: 60,
    format: (v) => `${v.toFixed(1)} s`,
  },
  count: {
    id: 'count',
    name: 'MOST OF THEM',
    brief: 'Most wheelies over ten metres. Pop it, land it, go again.',
    seconds: 45,
    format: (v) => `${Math.round(v)}`,
  },
  total: {
    id: 'total',
    name: 'MOST GROUND',
    brief: 'Every metre you spend on the back wheel adds up. Nothing is wasted.',
    seconds: 60,
    format: (v) => `${v.toFixed(0)} m total`,
  },
};

export const CHALLENGE_IDS: ChallengeId[] = ['distance', 'time', 'count', 'total'];

/** What somebody has put on the table. */
export type Stake =
  | { kind: 'cash'; amount: number }
  | { kind: 'outfit'; outfit: OutfitId }
  | { kind: 'aura'; amount: number };

export function stakeValue(s: Stake): number {
  if (s.kind === 'cash') return s.amount;
  if (s.kind === 'aura') return s.amount * AURA_IN_DOLLARS;
  return OUTFITS[s.outfit].value;
}

export function stakeLabel(s: Stake): string {
  if (s.kind === 'cash') return `$${Math.round(s.amount).toLocaleString('en-US')}`;
  if (s.kind === 'aura') return `${s.amount} aura`;
  return OUTFITS[s.outfit].name;
}

/**
 * What one point of aura is worth in dollars at the table.
 *
 * Aura is not money and mostly cannot be spent, but it has to be priced or it
 * cannot be staked against money. Deliberately high: aura is slow to earn and
 * putting it up should feel like putting something real up.
 */
export const AURA_IN_DOLLARS = 900;

/** The terms the broker arrived at. */
export interface Terms {
  challenge: Challenge;
  /** What each side puts up. */
  yours: Stake;
  theirs: Stake;
  /** 0..1, your chance of taking it, as the broker sees it. */
  yourOdds: number;
  /** True if the rival will sign this. */
  theyAccept: boolean;
  /** One line explaining why the numbers are what they are. */
  note: string;
}

/** Everything the broker needs to know about who is riding. */
export interface Contender {
  /** 0..1. Higher is better at this. */
  skill: number;
}

/**
 * Your chance of winning, as a number between 0.1 and 0.9.
 *
 * Never 0 and never 1: a bet nobody can lose is not a bet, and a rider who
 * cannot possibly win will not turn up. Clamping also stops the stake maths
 * running away to silly numbers at the ends.
 */
export function oddsFor(you: Contender, them: Contender): number {
  const edge = you.skill - them.skill;
  // A logistic curve, so a small edge moves the odds a little and a big one
  // moves them a lot without ever reaching certainty.
  const p = 1 / (1 + Math.exp(-edge * 4.2));
  return Math.max(0.1, Math.min(0.9, p));
}

/**
 * What the other side has to put up for the bet to be honest.
 *
 * Winner takes the other's stake, so across the two outcomes:
 *
 *     your EV  = P(win) * theirStake - P(lose) * yourStake
 *
 * and that is zero - the definition of a fair bet - when
 *
 *     theirStake = yourStake * P(you lose) / P(you win)
 *
 * Which says the **favourite stakes more**: you are 90% to win, they only cover
 * a ninth of what you put up, because they will be collecting it nine times out
 * of ten. Getting this the wrong way up is very easy and reads plausibly - the
 * harness caught it by checking the expected values rather than the formula.
 */
export function fairCounter(yourStakeValue: number, yourOdds: number): number {
  return (yourStakeValue * (1 - yourOdds)) / yourOdds;
}

/** Rounds a dollar figure to something a person would actually say out loud. */
export function roundMoney(v: number): number {
  if (v < 200) return Math.max(25, Math.round(v / 25) * 25);
  if (v < 2000) return Math.round(v / 50) * 50;
  if (v < 20000) return Math.round(v / 250) * 250;
  return Math.round(v / 1000) * 1000;
}

export interface BrokerInput {
  challenge: Challenge;
  you: Contender;
  them: Contender;
  /** What the player asked to put up. */
  yourStake: Stake;
  /** What the rival would like off you, if anything. */
  theirWant: Stake | null;
  /** Outfits the rival has that they could be made to stake. */
  theirOutfits: OutfitId[];
  /** How much cash the rival can cover. */
  theirCash: number;
}

/**
 * Works out honest terms for a wager, given what both sides asked for.
 *
 * Justin: "the AI makes a suggestion that is fair to both of you that takes
 * your bet request into consideration. It always does it fairly, no benefit to
 * either party." So: take the player's stake as given, price the other side at
 * exactly the value that equalises expected value, and then find the closest
 * real thing the rival actually owns to that number - preferring whatever they
 * said they wanted, if it fits.
 */
export function broker(input: BrokerInput): Terms {
  const yourOdds = oddsFor(input.you, input.them);
  let yours = input.yourStake;
  let theirs: Stake;

  // If the player named something they want off the rival, that is the fixed
  // side and the player's own stake moves to meet it. Justin's version is that
  // you say what you want and the game finds honest terms around it, not that
  // the game tells you what you are allowed to want.
  const wanted = input.theirWant;
  if (wanted && wanted.kind === 'outfit' && input.theirOutfits.includes(wanted.outfit)) {
    theirs = wanted;
    const need = fairCounter(stakeValue(theirs), 1 - yourOdds);
    // Cash is the only divisible thing at the table, so it is what gets moved.
    // An outfit staked against an outfit cannot be adjusted, and stays as it is
    // with whatever skew that leaves - reported honestly below.
    if (yours.kind === 'cash') yours = { kind: 'cash', amount: roundMoney(need) };
  } else {
    const need = fairCounter(stakeValue(yours), yourOdds);
    // The closest thing the rival actually owns, cash included.
    const options: Stake[] = [
      ...input.theirOutfits.map((o) => ({ kind: 'outfit' as const, outfit: o })),
      { kind: 'cash' as const, amount: roundMoney(Math.min(need, input.theirCash)) },
    ];
    let best = options[options.length - 1];
    let bestErr = Infinity;
    for (const o of options) {
      const err = Math.abs(stakeValue(o) - need);
      if (err < bestErr) { bestErr = err; best = o; }
    }
    theirs = best;
    // They could not cover it, or the closest item they own is well off. Bring
    // the player's side down to meet what is actually on the table rather than
    // proposing a bet that quietly favours one of them. "No benefit to either
    // party" has to mean the broker never SUGGESTS a lopsided bet, not merely
    // that the rival declines one.
    if (yours.kind === 'cash') {
      const back = fairCounter(stakeValue(theirs), 1 - yourOdds);
      yours = { kind: 'cash', amount: roundMoney(back) };
    }
  }

  const mine = stakeValue(yours);
  const theirValue = stakeValue(theirs);
  // How far off level the final terms are, after rounding to numbers a person
  // would say out loud.
  const yourEV = theirValue * yourOdds;
  const theirEV = mine * (1 - yourOdds);
  const balance = Math.min(yourEV, theirEV) / Math.max(yourEV, theirEV, 1e-6);
  const affordable = theirs.kind !== 'cash' || theirs.amount <= input.theirCash;
  const theyAccept = affordable && balance > 0.72;

  const pct = Math.round(yourOdds * 100);
  const note = !affordable
    ? 'They cannot cover that. Ask for less.'
    : !theyAccept
      ? 'Neither of you should sign that — it is too far one way.'
      : yourOdds > 0.56
        ? `They make you ${pct}% to win it, so you are covering the most.`
        : yourOdds < 0.44
          ? `They make themselves ${100 - pct}% to win it, so they are covering the most.`
          : `They call it about even at ${pct}%, so the stakes match.`;

  return { challenge: input.challenge, yours, theirs, yourOdds, theyAccept, note };
}

/**
 * Aura for taking one.
 *
 * Scaled by how much of an underdog you were: beating somebody better than you
 * is what aura IS. Losing costs a little, but never below nothing - aura is a
 * reputation, and you cannot have a negative one, you just have none.
 */
export function auraFor(won: boolean, yourOdds: number): number {
  if (!won) return -1;
  // 1 at even money, up to 5 for taking down a heavy favourite.
  return Math.max(1, Math.round((1 - yourOdds) * 8));
}

/** A running score for one side of a battle. */
export class Scorecard {
  best = 0;
  bestTime = 0;
  count = 0;
  total = 0;

  /** Call when a wheelie ends. `metres` and `seconds` are that single run. */
  land(metres: number, seconds: number): void {
    if (metres > this.best) this.best = metres;
    if (seconds > this.bestTime) this.bestTime = seconds;
    if (metres >= 10) this.count++;
    this.total += metres;
  }

  /** Live value for the metric being contested, including the run in progress. */
  score(id: ChallengeId, liveMetres = 0, liveSeconds = 0): number {
    switch (id) {
      case 'distance': return Math.max(this.best, liveMetres);
      case 'time': return Math.max(this.bestTime, liveSeconds);
      case 'count': return this.count + (liveMetres >= 10 ? 1 : 0);
      case 'total': return this.total + liveMetres;
    }
  }

  reset(): void {
    this.best = 0;
    this.bestTime = 0;
    this.count = 0;
    this.total = 0;
  }
}
