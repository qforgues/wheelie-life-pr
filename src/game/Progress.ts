import { STARTER_BIKE, type BikeId } from '../sim/tuning';
import { isTrafficSpeed, type TrafficSpeed } from '../world/Traffic';
import { isPoliceStyle, type PoliceStyle } from '../world/Police';
import { isOrientation, type MapOrientation } from '../ui/Minimap';
import { DEFAULT_AIM, isMirrorMount, type MirrorAim, type MirrorMount } from '../view/Mirrors';
import { UPGRADES, UPGRADE_IDS, nextLevel, type UpgradeId, type UpgradeLevels } from './Upgrades';

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
  mirrorAim: MirrorAim;
  /** Upgrade levels owned, per bike. */
  upgrades: Partial<Record<BikeId, UpgradeLevels>>;
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
  mirrorAim: MirrorAim = { ...DEFAULT_AIM };
  /** What is bolted to each bike. Money's second job. */
  upgrades: Partial<Record<BikeId, UpgradeLevels>> = {};

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

  /** Levels owned of one part on one bike. */
  levelOf(bike: BikeId, id: UpgradeId): number {
    return this.upgrades[bike]?.[id] ?? 0;
  }

  /** All the levels bolted to a bike, for applying to its tuning. */
  levelsFor(bike: BikeId): UpgradeLevels {
    return this.upgrades[bike] ?? {};
  }

  /**
   * Buys the next level of one part. Returns false if it is maxed or you
   * cannot afford it.
   */
  buyUpgrade(bike: BikeId, id: UpgradeId): boolean {
    const owned = this.levelOf(bike, id);
    const next = nextLevel(id, owned);
    if (!next || !this.canAfford(next.price)) return false;
    this.money -= next.price;
    const forBike = this.upgrades[bike] ?? (this.upgrades[bike] = {});
    forBike[id] = owned + 1;
    this.save();
    return true;
  }

  /** What has been sunk into a bike, for the garage to show. */
  investedIn(bike: BikeId): number {
    let total = 0;
    for (const id of UPGRADE_IDS) {
      const owned = this.levelOf(bike, id);
      for (let i = 0; i < owned; i++) total += UPGRADES[id].levels[i].price;
    }
    return total;
  }

  setMirrorAim(aim: MirrorAim): void {
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    this.mirrorAim = { lx: c(aim.lx), ly: c(aim.ly), rx: c(aim.rx), ry: c(aim.ry) };
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
    this.mirrorAim = { ...DEFAULT_AIM };
    this.upgrades = {};
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
      if (d.upgrades && typeof d.upgrades === 'object') {
        // Clamp anything a hand-edited save might contain.
        const clean: Partial<Record<BikeId, UpgradeLevels>> = {};
        for (const [bike, levels] of Object.entries(d.upgrades)) {
          const out: UpgradeLevels = {};
          for (const id of UPGRADE_IDS) {
            const n = (levels as UpgradeLevels)[id];
            if (typeof n === 'number' && n > 0) {
              out[id] = Math.min(Math.floor(n), UPGRADES[id].levels.length);
            }
          }
          clean[bike as BikeId] = out;
        }
        this.upgrades = clean;
      }
      const a = d.mirrorAim as unknown as Record<string, unknown> | undefined;
      if (a && ['lx', 'ly', 'rx', 'ry'].every((k) => typeof a[k] === 'number')) {
        this.mirrorAim = d.mirrorAim as MirrorAim;
      }
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
        mirrorAim: this.mirrorAim,
        upgrades: this.upgrades,
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
