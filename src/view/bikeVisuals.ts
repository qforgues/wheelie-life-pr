import { castStreetWheel, spokedDirtWheel, type WheelSpec } from './Wheel';
import type { BikeId } from '../sim/tuning';

/**
 * How a bike is built and painted.
 *
 * Justin asked for three bikes that feel and look genuinely different, so this
 * is data alongside the tuning in sim/tuning.ts. Adding the Ducati later is a
 * new entry here plus a bodywork builder, not a rewrite.
 */
export interface BikeVisual {
  /** Selects which bodywork builder runs. */
  style: 'dirt' | 'mini' | 'sport';
  /** Main painted panels. */
  bodyColor: number;
  /** Number plates, seat piping, contrast panels. */
  accentColor: number;
  /** Rim colour. */
  rimColor: number;
  frontWheel: WheelSpec;
  rearWheel: WheelSpec;
  /** Front axle height, which is the front wheel's rolling radius (m). */
  frontWheelRadius: number;
  /** Height of the rider's hips above the road when seated (m). */
  hipHeight: number;
  /** Where along the bike the rider sits, from the rear contact patch (m). */
  seatZ: number;
  /** Grip position in fork-local space (x, y, z from the front axle). */
  gripLocal: [number, number, number];
  /** Footpeg position in bike-local space. */
  pegLocal: [number, number, number];
  /** Extra forward hip rotation (rad). A sportbike rider is folded over the
   *  tank; a dirt rider sits up. */
  riderPitch?: number;
  shirt: [string, string, string, string];
  /** Shown on the bike select screen. */
  displayName: string;
  tagline: string;
  /** One-line summary of how it rides, for the picker. */
  character: string;
}

const YZ_FRONT_R = 0.347; // 80/100-21
const YZ_REAR_R = 0.331;  // 100/90-19

export const BIKE_VISUALS: Record<BikeId, BikeVisual> = {
  yz250f: {
    displayName: 'Yamaha YZ250F',
    tagline: '2024 · 250cc · 43 hp',
    character: 'Light, tall and snappy. Lofts in four gears and holds a wheelie better than anything else here.',
    style: 'dirt',
    // Team Yamaha blue, white plates, blue anodised rims.
    bodyColor: 0x1b45b4,
    accentColor: 0xf2f4f7,
    rimColor: 0x2f6bd8,
    frontWheel: spokedDirtWheel(YZ_FRONT_R, 0.115),
    rearWheel: spokedDirtWheel(YZ_REAR_R, 0.145),
    frontWheelRadius: YZ_FRONT_R,
    hipHeight: 1.02,
    seatZ: 0.60,
    gripLocal: [0.34, 0.95, -0.44],
    pegLocal: [0.20, 0.44, 0.58],
    shirt: ['#efe9dc', 'GOOD', 'BIKES', 'BETTER DAYS'],
  },
  grom: {
    displayName: 'Honda Grom',
    tagline: '190cc big-bore · 21 hp',
    character: 'Small, slow and forgiving. Only lifts in 1st and 2nd, so you learn to time the pull. Start here.',
    style: 'mini',
    bodyColor: 0x1f5fd0,
    accentColor: 0xf0efe6,
    rimColor: 0xd8b04a,
    frontWheel: castStreetWheel(0.24, 0.14),
    rearWheel: castStreetWheel(0.24, 0.17),
    frontWheelRadius: 0.24,
    hipHeight: 0.88,
    seatZ: 0.40,
    gripLocal: [0.29, 0.74, -0.27],
    pegLocal: [0.17, 0.44, 0.50],
    shirt: ['#efe9dc', 'GOOD', 'BIKES', 'BETTER DAYS'],
  },
  streetfighter: {
    displayName: 'Ducati Streetfighter V4',
    tagline: '1103cc V4 · 208 hp',
    character: 'Brutal and heavy. It will come up on throttle alone in three gears, and then fight you the whole way.',
    style: 'sport',
    // Ducati red over a black frame, black forged wheels.
    bodyColor: 0xc4161c,
    accentColor: 0x1a1c22,
    rimColor: 0x26282e,
    frontWheel: castStreetWheel(0.300, 0.130),
    rearWheel: castStreetWheel(0.336, 0.205),
    frontWheelRadius: 0.300,
    hipHeight: 0.90,
    seatZ: 0.56,
    gripLocal: [0.305, 0.72, -0.345],
    pegLocal: [0.20, 0.44, 0.36],
    riderPitch: 0.26,
    shirt: ['#efe9dc', 'GOOD', 'BIKES', 'BETTER DAYS'],
  },
};
