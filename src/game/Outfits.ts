/**
 * What you wear, and why it is worth something.
 *
 * Justin's rule: **gear can only be won.** You cannot buy the Piratas kit at
 * any price - somebody has to lose it to you across a wheelie battle. That is
 * the whole reason the battles exist, and it is why an outfit needs a value:
 * when you put it on the table it has to be worth a number, or the broker
 * cannot make the bet fair.
 *
 * Three of them, which is Justin's spec:
 *   1. what you start in
 *   2. what you take off somebody
 *   3. the one only he has
 */

export type OutfitId = 'calle' | 'piratas' | 'monoestrellada';

export const OUTFIT_IDS: OutfitId[] = ['calle', 'piratas', 'monoestrellada'];

export const STARTER_OUTFIT: OutfitId = 'calle';

/** A stripe pattern behind the letters on the back of the helmet. */
export interface Decal {
  text: string;
  /** Two stripe colours, drawn as a flag behind the letters. */
  flag: [string, string];
  ink: string;
}

export interface Outfit {
  id: OutfitId;
  name: string;
  tagline: string;
  character: string;
  /** Jersey, and the contrast panel on the shoulders and sleeves. */
  jersey: number;
  sleeve: number;
  trousers: number;
  helmet: number;
  helmetTrim: number;
  gloves: number;
  boots: number;
  bootTrim: number;
  /** Back-of-helmet plate. null leaves it plain. */
  decal: Decal | null;
  /**
   * What it costs in the closet.
   *
   * `WIN_ONLY` means no amount of money buys it - the only way in is to take it
   * off a rider who has it, which is the point.
   */
  price: number;
  /**
   * What it is worth when staked at the table.
   *
   * Not the same as the price. The monoestrellada costs 100k because it is a
   * trophy; it is worth rather less as a bet, because nobody sensible matches a
   * hundred thousand on one wheelie.
   */
  value: number;
}

/** A price that means "cannot be bought at any price". */
export const WIN_ONLY = -1;

/**
 * How La Monoestrellada is actually unlocked.
 *
 * It sat at $100,000 as a placeholder because we had not decided. The answer we
 * both liked is that money should have nothing to do with it: **you take a
 * wheelie battle off every single one of Los Piratas.** Seven riders, every one
 * of them beaten at least once, and the kit turns up in your closet.
 *
 * That makes it the only thing in the game you cannot shortcut. You can buy a
 * Ducati; you cannot buy this.
 */
export const MONOESTRELLADA_NEEDS = 7;

export const OUTFITS: Record<OutfitId, Outfit> = {
  calle: {
    id: 'calle',
    name: 'Calle',
    tagline: 'What you turned up in',
    character: 'A jersey, jeans and a lid that matches the bike. Nobody is impressed, and nobody has to be.',
    jersey: 0xefe9dc,
    sleeve: 0x3a4a68,
    trousers: 0x3a4a68,
    // 0 means "take the bike's own colour", which is what it has always done.
    helmet: 0,
    helmetTrim: 0xf2f2ee,
    gloves: 0x22242b,
    boots: 0x1a1b20,
    bootTrim: 0,
    decal: null,
    price: 0,
    value: 0,
  },
  piratas: {
    id: 'piratas',
    name: 'Los Piratas',
    tagline: 'VQS Bike Club — won, never bought',
    character: 'Club colours. You cannot buy this at any price; you take it off somebody who has it.',
    jersey: 0x14161c,
    sleeve: 0xd8232a,
    trousers: 0x14161c,
    helmet: 0x14161c,
    helmetTrim: 0xd8dce4,
    gloves: 0x1a1b20,
    boots: 0x1a1b20,
    bootTrim: 0xd8232a,
    decal: { text: 'VQS', flag: ['#ffffff', '#7fc8e8'], ink: '#14161c' },
    price: WIN_ONLY,
    value: 6000,
  },
  monoestrellada: {
    id: 'monoestrellada',
    name: 'La Monoestrellada',
    tagline: 'Black and gold. Beat every one of them.',
    character: 'Black leather with gold, and one gold star. There is no price on it and there never will be — you get it by taking a wheelie battle off every single one of Los Piratas.',
    // Black head to foot with gold as the only other colour, so it reads as the
    // one special thing in the game from across a junction rather than as
    // another kit. Every other outfit has at least two colours fighting; this
    // one has one, and that is what makes it look expensive.
    jersey: 0x0b0c10,
    sleeve: 0xd4a534,
    trousers: 0x0b0c10,
    helmet: 0x0b0c10,
    helmetTrim: 0xd4a534,
    gloves: 0x0b0c10,
    boots: 0x0b0c10,
    bootTrim: 0xd4a534,
    decal: { text: '★', flag: ['#0b0c10', '#141721'], ink: '#d4a534' },
    price: WIN_ONLY,
    value: 24000,
  },
};

export function isOutfitId(v: unknown): v is OutfitId {
  return typeof v === 'string' && (OUTFIT_IDS as string[]).includes(v);
}
