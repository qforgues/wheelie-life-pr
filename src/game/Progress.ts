import { STARTER_BIKE, type BikeId } from '../sim/tuning';
import { isTrafficSpeed, type TrafficSpeed } from '../world/Traffic';
import { isPoliceStyle, type PoliceStyle } from '../world/Police';
import { isOrientation, type MapOrientation } from '../ui/Minimap';
import { isMirrorMount, type MirrorMount } from '../view/Mirrors';

/**
 * Money and what you own.
 *
 * Justin asked for money, bought bikes, and the Grom free at the start. Until
 * now all three bikes were unlocked, which made "free" meaningless and left
 * riding with no reason to push beyond watching the number go up.
 *
 * Kept out of the sim deliberately: physics has no business knowing about a
 * wallet, and the save has no business knowing about newtons.
 */
export interface SaveData {
  money: number;
  owned: BikeId[];
  lastBike: BikeId;
  bestScore: number;
  traffic: TrafficSpeed;
  scanner: boolean;
  police: PoliceStyle;
  mapOrientation: MapOrientation;
  mirrors: MirrorMount;
  mirrorAimX: number;
  mirrorAimY: number;
}

/**
 * What the police scanner costs. A serious purchase - it sits between the
 * YZ250F and the Ducati, so buying it is a real decision about what you want
 * next rather than pocket change.
 */
export const SCANNER_PRICE = 6000;

const KEY = 'wheelie-life:save:v1';

/** Dollars per scored metre. Tricks already multiply the score, so they pay. */
const RATE = 2;
/** Bonus for beating your own record, so there's a reason to push. */
const RECORD_BONUS = 250;

export class Progress {
  money = 0;
  owned = new Set<BikeId>([STARTER_BIKE]);
  lastBike: BikeId = STARTER_BIKE;
  bestScore = 0;
  /** Justin's call every session, so it is remembered rather than re-picked. */
  traffic: TrafficSpeed = 'regular';
  /** Shows patrols on the GPS. Justin asked for this as a purchase. */
  scanner = false;
  /** How hard la policía plays. Justin's call, saved between sessions. */
  police: PoliceStyle = 'professional';
  /** Whether the GPS keeps the city still or the rider still. */
  mapOrientation: MapOrientation = 'north';
  /** Where the mirrors hang, and the rider's trim on them. */
  mirrors: MirrorMount = 'corners';
  mirrorAimX = 0;
  mirrorAimY = 0;

  /** Set for one frame after a payout, for the HUD toast. */
  lastPayout = 0;
  lastWasRecord = false;

  constructor() {
    this.load();
  }

  /**
   * Banks a completed run. Crashed runs never get here - landing it is part of
   * the trick, and the payout follows the same rule as the record.
   */
  bank(score: number): number {
    if (score <= 0) return 0;
    let paid = Math.round(score * RATE);
    this.lastWasRecord = score > this.bestScore;
    if (this.lastWasRecord) {
      paid += RECORD_BONUS;
      this.bestScore = score;
    }
    this.money += paid;
    this.lastPayout = paid;
    this.save();
    return paid;
  }

  has(id: BikeId): boolean {
    return this.owned.has(id);
  }

  canAfford(price: number): boolean {
    return this.money >= price;
  }

  /** Buys a bike. Returns false if it's already owned or unaffordable. */
  buy(id: BikeId, price: number): boolean {
    if (this.owned.has(id) || !this.canAfford(price)) return false;
    this.money -= price;
    this.owned.add(id);
    this.save();
    return true;
  }

  setLastBike(id: BikeId): void {
    this.lastBike = id;
    this.save();
  }

  /** Buys the police scanner. Returns false if already owned or unaffordable. */
  buyScanner(): boolean {
    if (this.scanner || !this.canAfford(SCANNER_PRICE)) return false;
    this.money -= SCANNER_PRICE;
    this.scanner = true;
    this.save();
    return true;
  }

  /**
   * A fine for getting pulled over: a fifth of what's on hand, capped.
   *
   * Proportional rather than flat so it stings the same at every stage - a flat
   * fine is brutal when you are saving for your first bike and meaningless once
   * you own the Ducati.
   */
  fine(): number {
    const owed = Math.min(400, Math.round(this.money * 0.2));
    this.money -= owed;
    this.save();
    return owed;
  }

  setTraffic(t: TrafficSpeed): void {
    this.traffic = t;
    this.save();
  }

  setPolice(p: PoliceStyle): void {
    this.police = p;
    this.save();
  }

  setMapOrientation(o: MapOrientation): void {
    this.mapOrientation = o;
    this.save();
  }

  setMirrors(m: MirrorMount): void {
    this.mirrors = m;
    this.save();
  }

  setMirrorAim(x: number, y: number): void {
    this.mirrorAimX = Math.max(-1, Math.min(1, x));
    this.mirrorAimY = Math.max(-1, Math.min(1, y));
    this.save();
  }

  /** Wipes back to a fresh save. Exposed in the tuning panel for testing. */
  reset(): void {
    this.money = 0;
    this.owned = new Set<BikeId>([STARTER_BIKE]);
    this.lastBike = STARTER_BIKE;
    this.bestScore = 0;
    this.traffic = 'regular';
    this.scanner = false;
    this.police = 'professional';
    this.mapOrientation = 'north';
    this.mirrors = 'corners';
    this.mirrorAimX = 0;
    this.mirrorAimY = 0;
    this.save();
  }

  // localStorage throws outright in some contexts - a private window, a
  // browser set to block site data, a thumbnail capture. Losing the save is
  // survivable; taking the game down with it is not.
  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<SaveData>;
      if (typeof d.money === 'number' && Number.isFinite(d.money)) {
        this.money = Math.max(0, d.money);
      }
      if (Array.isArray(d.owned)) {
        this.owned = new Set<BikeId>([STARTER_BIKE, ...d.owned]);
      }
      if (d.lastBike && this.owned.has(d.lastBike)) this.lastBike = d.lastBike;
      if (typeof d.bestScore === 'number' && Number.isFinite(d.bestScore)) {
        this.bestScore = Math.max(0, d.bestScore);
      }
      if (isTrafficSpeed(d.traffic)) this.traffic = d.traffic;
      if (typeof d.scanner === 'boolean') this.scanner = d.scanner;
      if (isPoliceStyle(d.police)) this.police = d.police;
      if (isOrientation(d.mapOrientation)) this.mapOrientation = d.mapOrientation;
      if (isMirrorMount(d.mirrors)) this.mirrors = d.mirrors;
      if (typeof d.mirrorAimX === 'number') this.mirrorAimX = d.mirrorAimX;
      if (typeof d.mirrorAimY === 'number') this.mirrorAimY = d.mirrorAimY;
    } catch {
      /* no save, or storage is unavailable - start fresh */
    }
  }

  private save(): void {
    try {
      const data: SaveData = {
        money: this.money,
        owned: [...this.owned],
        lastBike: this.lastBike,
        bestScore: this.bestScore,
        traffic: this.traffic,
        scanner: this.scanner,
        police: this.police,
        mapOrientation: this.mapOrientation,
        mirrors: this.mirrors,
        mirrorAimX: this.mirrorAimX,
        mirrorAimY: this.mirrorAimY,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* nothing to do - the session still works, it just won't persist */
    }
  }
}

/** Formats money the way the HUD and the garage show it. */
export function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
