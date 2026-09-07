import { LAYOUT, MAP } from '../world/City';

/**
 * The GPS.
 *
 * A city you can get lost in needs one, and the grid only became worth
 * navigating once it stopped being a single street. North-up and centred on the
 * rider: a rotating map is prettier and much harder to read at a glance, and a
 * glance is all you get while holding a wheelie.
 *
 * Everything here is drawn from LAYOUT, so it cannot go stale when a road moves.
 */

/** Metres from the rider to the edge of the map view. */
const RANGE = 210;

export interface MapBlip {
  x: number;
  z: number;
  kind: 'cop' | 'poi';
}

export class Minimap {
  readonly root: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;
  private size = 0;

  constructor() {
    this.root = document.createElement('canvas');
    this.root.className = 'minimap';
    this.ctx = this.root.getContext('2d')!;
    this.resize();
  }

  /** Canvas backing store follows DPR so the roads stay crisp on a TV. */
  resize(): void {
    const css = this.root.clientWidth || 168;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.size = css;
    this.root.width = Math.round(css * dpr);
    this.root.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param yaw  rider heading; 0 faces +Z, which is "up" on this map.
   * @param blips cops and points of interest, in world coordinates.
   */
  draw(x: number, z: number, yaw: number, blips: MapBlip[], heat: number): void {
    const c = this.ctx;
    const s = this.size;
    if (this.root.clientWidth && this.root.clientWidth !== s) this.resize();
    const half = s / 2;
    const scale = half / RANGE;

    // World -> map. +Z is up, so the vertical axis is negated.
    const px = (wx: number) => half + (wx - x) * scale;
    const pz = (wz: number) => half - (wz - z) * scale;

    c.clearRect(0, 0, s, s);

    c.fillStyle = 'rgba(12, 16, 24, 0.72)';
    c.fillRect(0, 0, s, s);

    // Roads. Two passes so the casing reads as a kerb at any zoom.
    const roadPx = Math.max(3, LAYOUT.roadHalf * 2 * scale);
    for (const pass of [
      { w: roadPx + 2, style: 'rgba(0,0,0,0.45)' },
      { w: roadPx, style: 'rgba(150,163,180,0.85)' },
    ]) {
      c.strokeStyle = pass.style;
      c.lineWidth = pass.w;
      c.beginPath();
      for (const ax of LAYOUT.avenueX) {
        c.moveTo(px(ax), pz(MAP.zMin));
        c.lineTo(px(ax), pz(MAP.zMax));
      }
      for (const sz of LAYOUT.streetZ) {
        c.moveTo(px(MAP.xMin), pz(sz));
        c.lineTo(px(MAP.xMax), pz(sz));
      }
      c.stroke();
    }

    // The waterfront plaza, so there is one landmark that isn't a junction.
    const p = LAYOUT.plaza;
    c.fillStyle = 'rgba(83, 201, 214, 0.5)';
    c.fillRect(px(p.xMin), pz(p.zMax), (p.xMax - p.xMin) * scale, (p.zMax - p.zMin) * scale);

    for (const b of blips) {
      const bx = px(b.x);
      const bz = pz(b.z);
      if (bx < -8 || bx > s + 8 || bz < -8 || bz > s + 8) continue;
      c.beginPath();
      c.arc(bx, bz, b.kind === 'cop' ? 4.5 : 3.5, 0, Math.PI * 2);
      c.fillStyle = b.kind === 'cop' ? '#ff4d5a' : '#e0a13a';
      c.fill();
      if (b.kind === 'cop') {
        c.strokeStyle = 'rgba(255,255,255,0.85)';
        c.lineWidth = 1.2;
        c.stroke();
      }
    }

    // The rider: a triangle pointing where they are actually looking.
    c.save();
    c.translate(half, half);
    c.rotate(-yaw);
    c.beginPath();
    c.moveTo(0, -7.5);
    c.lineTo(5, 6);
    c.lineTo(0, 3.5);
    c.lineTo(-5, 6);
    c.closePath();
    c.fillStyle = '#5edbe9';
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.65)';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();

    // Heat ring: the border goes red as the police interest rises.
    if (heat > 0) {
      c.strokeStyle = `rgba(255, 77, 90, ${Math.min(1, 0.35 + heat * 0.25)})`;
      c.lineWidth = 3;
      c.strokeRect(1.5, 1.5, s - 3, s - 3);
    }
  }
}
