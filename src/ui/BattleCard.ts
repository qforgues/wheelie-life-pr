import type { Battle } from '../game/Battle';
import { stakeLabel, type Stake } from '../game/Battles';
import { OUTFITS, type OutfitId } from '../game/Outfits';

/**
 * The wheelie battle prompt, and the scoreboard once it is on.
 *
 * Justin's flow: you make contact, a prompt comes up with the details, and you
 * say yes or no. The bit in the middle is the haggling - you pick what you are
 * willing to put up and what you want off them, and the broker comes back with
 * honest terms. It shows the odds, because the odds are WHY the stakes are not
 * equal, and hiding that would make a fair bet look like a rigged one.
 */
export class BattleCard {
  readonly root: HTMLDivElement;

  private offerEl!: HTMLElement;
  private liveEl!: HTMLElement;
  private onDecide: ((yes: boolean) => void) | null = null;
  private onRenegotiate: ((stake: Stake, want: Stake | null) => void) | null = null;

  /** What the player currently has on the table. */
  private stake: Stake = { kind: 'cash', amount: 250 };
  private want: Stake | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'battle';
    this.root.innerHTML = `
      <div class="battle-offer" data-el="offerEl" hidden></div>
      <div class="battle-live" data-el="liveEl" hidden></div>`;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-el]')) {
      (this as unknown as Record<string, HTMLElement>)[el.dataset.el!] = el;
    }

    this.offerEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const yes = t.closest('[data-yes]');
      const no = t.closest('[data-no]');
      if (yes) { this.onDecide?.(true); return; }
      if (no) { this.onDecide?.(false); return; }
      const bet = t.closest<HTMLElement>('[data-bet]');
      if (bet) {
        this.stake = JSON.parse(bet.dataset.bet!) as Stake;
        this.onRenegotiate?.(this.stake, this.want);
        return;
      }
      const wants = t.closest<HTMLElement>('[data-want]');
      if (wants) {
        const v = wants.dataset.want!;
        this.want = v === 'none' ? null : { kind: 'outfit', outfit: v as OutfitId };
        this.onRenegotiate?.(this.stake, this.want);
      }
    });
  }

  onDecided(fn: (yes: boolean) => void): void {
    this.onDecide = fn;
  }

  onTermsChanged(fn: (stake: Stake, want: Stake | null) => void): void {
    this.onRenegotiate = fn;
  }

  /** Resets the table for a new meeting. */
  open(cash: number, aura: number): void {
    this.stake = { kind: 'cash', amount: Math.max(100, Math.min(1000, Math.round(cash * 0.1 / 50) * 50)) };
    this.want = null;
    void aura;
  }

  get currentStake(): Stake {
    return this.stake;
  }

  get currentWant(): Stake | null {
    return this.want;
  }

  hide(): void {
    this.offerEl.hidden = true;
    this.liveEl.hidden = true;
  }

  /** Draws the offer, with the stake picker and the broker's terms. */
  showOffer(battle: Battle, cash: number, aura: number, theirOutfits: OutfitId[]): void {
    this.liveEl.hidden = true;
    this.offerEl.hidden = false;
    const t = battle.terms;
    const c = t.challenge;

    const tiers = [100, 250, 500, 1000, 2500, 5000]
      .filter((v) => v <= Math.max(100, cash));
    const cashBtns = tiers.map((v) => {
      const on = this.stake.kind === 'cash' && this.stake.amount === v;
      return `<button type="button" class="chip${on ? ' is-on' : ''}"
        data-bet='{"kind":"cash","amount":${v}}'>$${v.toLocaleString('en-US')}</button>`;
    }).join('');
    const auraBtn = aura >= 2
      ? `<button type="button" class="chip chip-aura${this.stake.kind === 'aura' ? ' is-on' : ''}"
           data-bet='{"kind":"aura","amount":2}'>2 AURA</button>`
      : '';

    const wantBtns = [
      `<button type="button" class="chip${this.want === null ? ' is-on' : ''}" data-want="none">WHATEVER'S FAIR</button>`,
      ...theirOutfits.map((o) => {
        const on = this.want?.kind === 'outfit' && this.want.outfit === o;
        return `<button type="button" class="chip chip-kit${on ? ' is-on' : ''}" data-want="${o}">${OUTFITS[o].name.toUpperCase()}</button>`;
      }),
    ].join('');

    const pct = Math.round(t.yourOdds * 100);
    this.offerEl.innerHTML = `
      <div class="battle-head">
        <span class="battle-who">${battle.rivalName}</span>
        <span class="battle-what">${c.name}</span>
      </div>
      <p class="battle-brief">${c.brief} You have ${c.seconds} seconds.</p>

      <div class="battle-row">
        <span class="battle-label">YOU PUT UP</span>
        <div class="battle-chips">${cashBtns}${auraBtn}</div>
      </div>
      <div class="battle-row">
        <span class="battle-label">YOU WANT</span>
        <div class="battle-chips">${wantBtns}</div>
      </div>

      <div class="battle-terms${t.theyAccept ? '' : ' is-bad'}">
        <div class="battle-deal">
          <span><em>${stakeLabel(t.yours)}</em><small>yours</small></span>
          <span class="battle-vs">vs</span>
          <span><em>${stakeLabel(t.theirs)}</em><small>theirs</small></span>
        </div>
        <div class="battle-odds">
          <div class="battle-bar"><i style="width:${pct}%"></i></div>
          <span>${pct}% you</span>
        </div>
        <p class="battle-note">${t.note}</p>
      </div>

      <div class="battle-buttons">
        <button type="button" class="battle-no" data-no>RIDE ON</button>
        <button type="button" class="battle-yes" data-yes ${t.theyAccept ? '' : 'disabled'}>
          ${t.theyAccept ? "LET'S GO" : 'THEY WON’T SIGN'}
        </button>
      </div>`;
  }

  /** The scoreboard while it is on, and the result when it is done. */
  showLive(battle: Battle): void {
    this.offerEl.hidden = true;
    this.liveEl.hidden = false;
    const c = battle.challenge;

    if (battle.phase === 'countdown') {
      const n = Math.ceil(battle.clock);
      this.liveEl.innerHTML = `
        <div class="battle-count">${n > 0 ? n : 'GO'}</div>
        <div class="battle-sub">${c.name} — ${c.brief}</div>`;
      return;
    }

    if (battle.phase === 'result' && battle.outcome) {
      const o = battle.outcome;
      const prize: string[] = [];
      if (o.cash) prize.push(`${o.cash > 0 ? '+' : '−'}$${Math.abs(o.cash).toLocaleString('en-US')}`);
      if (o.gained) prize.push(`${OUTFITS[o.gained].name.toUpperCase()} IS YOURS`);
      if (o.lost) prize.push(`LOST THE ${OUTFITS[o.lost].name.toUpperCase()}`);
      if (o.aura > 0) prize.push(`+${o.aura} AURA`);
      else if (o.aura < 0) prize.push(`${o.aura} AURA`);
      this.liveEl.innerHTML = `
        <div class="battle-result ${o.won ? 'is-won' : 'is-lost'}">
          <div class="battle-verdict">${o.won ? '¡GANASTE!' : 'THEY TOOK IT'}</div>
          <div class="battle-final">
            <span>YOU <em>${c.format(o.yourScore)}</em></span>
            <span>${battle.rivalName} <em>${c.format(o.theirScore)}</em></span>
          </div>
          <div class="battle-prize">${prize.join('  ·  ')}</div>
        </div>`;
      return;
    }

    const yours = battle.yourScore;
    const theirs = battle.theirScore;
    const lead = yours > theirs ? 'is-ahead' : yours < theirs ? 'is-behind' : '';
    this.liveEl.innerHTML = `
      <div class="battle-score ${lead}">
        <span class="battle-clock">${Math.max(0, battle.clock).toFixed(0)}s</span>
        <span class="battle-side"><small>YOU</small><em>${c.format(yours)}</em></span>
        <span class="battle-side"><small>${battle.rivalName}</small><em>${c.format(theirs)}</em></span>
      </div>`;
  }
}
