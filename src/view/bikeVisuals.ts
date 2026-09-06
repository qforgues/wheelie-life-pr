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
  style: 'dirt' | 'mini';
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
  shirt: [string, string, string, string];
}

const YZ_FRONT_R = 0.347; // 80/100-21
const YZ_REAR_R = 0.331;  // 100/90-19

export const BIKE_VISUALS: Record<BikeId, BikeVisual> = {
  yz250f: {
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
};
