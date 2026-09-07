import {
  CHALLENGES, CHALLENGE_IDS, Scorecard, auraFor, broker,
  type ChallengeId, type Stake, type Terms,
} from './Battles';
import type { OutfitId } from './Outfits';

/**
 * One wheelie battle, from the moment you bump into somebody to the moment the
 * money changes hands.
 *
 *   contact -> offer -> countdown -> running -> result
 *
 * The offer is where you and the rival each say what you want on it and the
 * broker finds honest terms. Nothing is staked until you press YES, and either
 * of you can walk away from the table.
 *
 * The rival's score is not invented: they are out there riding, and the battle
 * watches what they actually do with the back wheel. Which means you can see
 * them earning it, and it means the number at the end is true.
 */

export type BattlePhase = 'offer' | 'countdown' | 'running' | 'result';

/** How long you get to sit on the start line. */
const COUNTDOWN = 3;
/** How long the result stays up before it clears itself. */
const RESULT_HOLD = 7;

export interface BattleOutcome {
  won: boolean;
  yourScore: number;
  theirScore: number;
  aura: number;
  /** Cash moved, signed from the player's side. */
  cash: number;
  /** Gear that changed hands, if any. */
  gained: OutfitId | null;
  lost: OutfitId | null;
}

export class Battle {
  phase: BattlePhase = 'offer';
  readonly rival: number;
  readonly rivalName: string;
  terms: Terms;
  clock = COUNTDOWN;
  you = new Scorecard();
  them = new Scorecard();
  outcome: BattleOutcome | null = null;
  /** True once the money has actually moved, so it moves exactly once. */
  settled = false;

  /** Live wheelie in progress, per side, so the score reads true mid-run. */
  private yourRun = 0;
  private yourRunTime = 0;
  private theirRun = 0;
  private theirRunTime = 0;
  private theirWasUp = false;

  constructor(rival: number, rivalName: string, terms: Terms) {
    this.rival = rival;
    this.rivalName = rivalName;
    this.terms = terms;
  }

  get challenge() {
    return this.terms.challenge;
  }

  /** Accepting starts the countdown. Both sides have already agreed the terms. */
  accept(): void {
    this.phase = 'countdown';
    this.clock = COUNTDOWN;
    this.you.reset();
    this.them.reset();
    this.yourRun = 0;
    this.yourRunTime = 0;
    this.theirRun = 0;
    this.theirRunTime = 0;
    this.theirWasUp = false;
  }

  get running(): boolean {
    return this.phase === 'running';
  }

  get yourScore(): number {
    return this.you.score(this.challenge.id, this.yourRun, this.yourRunTime);
  }

  get theirScore(): number {
    return this.them.score(this.challenge.id, this.theirRun, this.theirRunTime);
  }

  /**
   * Drives the clock and both scorecards.
   *
   * `yourWheelie` is the run you are on right now in metres, 0 when the front
   * wheel is down. `theirUp` / `theirRun` come straight off the rival, so their
   * score is what they actually rode rather than a number rolled for them.
   */
  update(
    dt: number,
    yourWheelie: number, yourDown: boolean,
    theirUp: boolean, theirRun: number,
  ): void {
    if (this.phase === 'countdown') {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.phase = 'running';
        this.clock = this.challenge.seconds;
      }
      return;
    }
    if (this.phase === 'result') {
      this.clock -= dt;
      return;
    }
    if (this.phase !== 'running') return;

    // ---- your side --------------------------------------------------------
    if (yourDown) {
      if (this.yourRun > 0) this.you.land(this.yourRun, this.yourRunTime);
      this.yourRun = 0;
      this.yourRunTime = 0;
    } else {
      this.yourRun = yourWheelie;
      this.yourRunTime += dt;
    }

    // ---- theirs -----------------------------------------------------------
    if (theirUp) {
      this.theirRun = theirRun;
      this.theirRunTime += dt;
    } else {
      if (this.theirWasUp && this.theirRun > 0) this.them.land(this.theirRun, this.theirRunTime);
      this.theirRun = 0;
      this.theirRunTime = 0;
    }
    this.theirWasUp = theirUp;

    this.clock -= dt;
    if (this.clock <= 0) this.finish();
  }

  /** Called when the clock runs out, or when you bin it and give up. */
  finish(): void {
    if (this.phase === 'result') return;
    // Bank whatever was in the air when the horn went. A run you were holding
    // at the end counts - the clock stopping is not you dropping it.
    if (this.yourRun > 0) this.you.land(this.yourRun, this.yourRunTime);
    if (this.theirRun > 0) this.them.land(this.theirRun, this.theirRunTime);
    this.yourRun = 0;
    this.theirRun = 0;

    const yours = this.you.score(this.challenge.id);
    const theirs = this.them.score(this.challenge.id);
    // A dead heat goes to the rider who did not call it. Somebody has to lose a
    // tie and it should not be the one who was already holding the gear.
    const won = yours > theirs;
    this.outcome = {
      won,
      yourScore: yours,
      theirScore: theirs,
      aura: auraFor(won, this.terms.yourOdds),
      cash: 0,
      gained: null,
      lost: null,
    };
    this.phase = 'result';
    this.clock = RESULT_HOLD;
  }

  /** True once the result has been up long enough to clear itself. */
  get spent(): boolean {
    return this.phase === 'result' && this.clock <= 0;
  }
}

/**
 * Picks the challenge for a meeting.
 *
 * Deterministic from who and when, so the prompt does not reshuffle itself
 * while you are reading it, but different every time you pull alongside.
 */
export function challengeFor(rival: number, seed: number): ChallengeId {
  const n = (rival * 7919 + Math.floor(seed) * 104729) >>> 0;
  return CHALLENGE_IDS[n % CHALLENGE_IDS.length];
}

/** Builds the opening offer for a meeting. */
export function offerFrom(
  rival: number, name: string, challengeId: ChallengeId,
  yourSkill: number, theirSkill: number,
  yourStake: Stake, theirWant: Stake | null,
  theirOutfits: OutfitId[], theirCash: number,
): Battle {
  const terms = broker({
    challenge: CHALLENGES[challengeId],
    you: { skill: yourSkill },
    them: { skill: theirSkill },
    yourStake,
    theirWant,
    theirOutfits,
    theirCash,
  });
  return new Battle(rival, name, terms);
}

export { CHALLENGES, CHALLENGE_IDS };
