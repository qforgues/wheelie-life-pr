import * as THREE from 'three';

/**
 * Every texture in the game is drawn at runtime on a 2D canvas. No art assets,
 * no loading screen, tiny build. Good enough to sell the Old San Juan look and
 * trivially re-tunable while we're still finding the art direction.
 */

/** Old San Juan facade colours: sun-bleached pastels over blue cobblestone. */
export const PALETTE = {
  facades: [
    '#7fb6cc', '#e9ba52', '#e0776b', '#8fc9a5', '#f0e0c0',
    '#c9714c', '#b49bc9', '#3ba39c', '#e79cb4', '#d9d24f',
    '#6f9fd8', '#efa15c',
  ],
  trim: ['#fbf6e9', '#f4ead3', '#ffffff'],
  shutters: ['#2f5d7c', '#1f6b52', '#8c3a2e', '#3a3f6b', '#5c4a2e'],
  cobble: '#5b6b7d',
  sea: '#1c7fa8',
};

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finish(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Speckled stucco wash. Sells "hand-painted plaster over stone". */
function stucco(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, rnd: () => number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.055; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const a = rnd() * 0.09;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Damp staining creeping up from the pavement - the island is humid.
  const grad = ctx.createLinearGradient(0, h, 0, h * 0.65);
  grad.addColorStop(0, 'rgba(40,50,40,0.30)');
  grad.addColorStop(1, 'rgba(40,50,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Vertical wrought-iron balusters with a top and bottom rail. */
function ironRail(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, rnd: () => number,
): void {
  ctx.strokeStyle = 'rgba(24,24,28,0.92)';
  ctx.lineWidth = Math.max(1.5, w * 0.011);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y);
  ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h);
  ctx.stroke();
  const bars = Math.max(4, Math.round(w / 9));
  ctx.lineWidth = Math.max(1, w * 0.007);
  for (let i = 0; i <= bars; i++) {
    const bx = x + (i / bars) * w;
    ctx.beginPath();
    ctx.moveTo(bx, y);
    // Slight belly on the balusters so they read as ironwork, not a fence.
    ctx.quadraticCurveTo(bx + (rnd() - 0.5) * 4, y + h * 0.5, bx, y + h);
    ctx.stroke();
  }
}

function window0(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  trim: string, shutter: string, rnd: () => number, balcony: boolean,
): void {
  // Recessed opening
  ctx.fillStyle = '#20242c';
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + w * 0.45);
  ctx.quadraticCurveTo(x + w / 2, y - h * 0.06, x + w, y + w * 0.45);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  // Glass, catching the sky
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(150,190,215,0.55)');
  g.addColorStop(0.5, 'rgba(60,80,100,0.35)');
  g.addColorStop(1, 'rgba(20,26,34,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(x + w * 0.08, y + w * 0.28, w * 0.84, h - w * 0.36);

  // Louvred shutters, thrown open
  ctx.fillStyle = shutter;
  const sw = w * 0.22;
  ctx.fillRect(x - sw * 0.85, y + w * 0.3, sw, h - w * 0.34);
  ctx.fillRect(x + w - sw * 0.15, y + w * 0.3, sw, h - w * 0.34);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  for (let ly = y + w * 0.36; ly < y + h - w * 0.1; ly += 4) {
    ctx.beginPath();
    ctx.moveTo(x - sw * 0.85, ly); ctx.lineTo(x - sw * 0.85 + sw, ly);
    ctx.moveTo(x + w - sw * 0.15, ly); ctx.lineTo(x + w - sw * 0.15 + sw, ly);
    ctx.stroke();
  }

  // Painted surround
  ctx.strokeStyle = trim;
  ctx.lineWidth = Math.max(2, w * 0.07);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + w * 0.45);
  ctx.quadraticCurveTo(x + w / 2, y - h * 0.06, x + w, y + w * 0.45);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();

  if (balcony) ironRail(ctx, x - w * 0.3, y + h * 0.55, w * 1.6, h * 0.42, rnd);
}

export function makeFacadeTexture(seed: number, floors = 3, bays = 3): THREE.CanvasTexture {
  const rnd = mulberry(seed);
  const W = 512;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);

  const base = PALETTE.facades[Math.floor(rnd() * PALETTE.facades.length)];
  const trim = PALETTE.trim[Math.floor(rnd() * PALETTE.trim.length)];
  const shutter = PALETTE.shutters[Math.floor(rnd() * PALETTE.shutters.length)];
  stucco(ctx, W, H, base, rnd);

  const floorH = H / floors;
  const bayW = W / bays;

  for (let f = 0; f < floors; f++) {
    const top = f * floorH;
    const isGround = f === floors - 1;

    // Cornice band between storeys
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, top, W, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fillRect(0, top + 5, W, 3);

    for (let b = 0; b < bays; b++) {
      const cx = b * bayW + bayW * 0.5;
      const ww = bayW * 0.42;
      const wh = floorH * 0.6;
      if (isGround && b === Math.floor(bays / 2)) {
        // A door on the middle bay at street level.
        const dw = bayW * 0.46;
        const dh = floorH * 0.78;
        ctx.fillStyle = shutter;
        ctx.fillRect(cx - dw / 2, top + floorH - dh, dw, dh);
        ctx.strokeStyle = trim;
        ctx.lineWidth = 5;
        ctx.strokeRect(cx - dw / 2, top + floorH - dh, dw, dh);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, top + floorH - dh); ctx.lineTo(cx, top + floorH);
        ctx.stroke();
      } else {
        window0(ctx, cx - ww / 2, top + floorH * 0.18, ww, wh, trim, shutter, rnd, f < floors - 1);
      }
    }
  }

  // Roof cornice
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 10, W, 5);

  return finish(canvas);
}

/** Blue adoquines - the ballast-stone cobbles Old San Juan is paved with. */
export function makeCobbleTexture(): THREE.CanvasTexture {
  const rnd = mulberry(7);
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#333c47';
  ctx.fillRect(0, 0, S, S);

  const rows = 28;
  const cell = S / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * cell * 0.5;
    for (let c = -1; c < rows + 1; c++) {
      const x = c * cell + offset;
      const y = r * cell;
      const shade = 0.84 + rnd() * 0.26;
      const blue = 86 + rnd() * 20;
      ctx.fillStyle = `rgb(${Math.round(70 * shade)},${Math.round(82 * shade)},${Math.round(blue * shade)})`;
      const inset = cell * 0.08;
      roundRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.18);
      ctx.fill();
      // Wet-looking highlight on the crown of each stone.
      ctx.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.025})`;
      roundRect(ctx, x + inset, y + inset, cell - inset * 2, (cell - inset * 2) * 0.4, cell * 0.14);
      ctx.fill();
    }
  }
  return finish(canvas, 1, 1);
}

/** Yellow/black diagonal hazard stripes for the speed bumps. */
export function makeHazardTexture(): THREE.CanvasTexture {
  const rnd = mulberry(55);
  const W = 256, H = 64;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#e0b420';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1c1d21';
  const band = 32;
  for (let x = -H; x < W + H; x += band * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + band, 0);
    ctx.lineTo(x + band - H, H);
    ctx.lineTo(x - H, H);
    ctx.closePath();
    ctx.fill();
  }
  // Scuffed by a few thousand cars.
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.22})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  return finish(canvas, 6, 1);
}

export function makeSidewalkTexture(): THREE.CanvasTexture {
  const rnd = mulberry(21);
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#a9a091';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.07})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * S;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  return finish(canvas, 1, 1);
}

/** The flag painted on a wall. "Aquí también se wheelea." */
export function makeFlagMuralTexture(): THREE.CanvasTexture {
  const rnd = mulberry(99);
  const W = 512, H = 320;
  const [canvas, ctx] = makeCanvas(W, H);
  stucco(ctx, W, H, '#e8e0cf', rnd);

  ctx.save();
  ctx.globalAlpha = 0.88;
  const stripe = H / 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#d4142c' : '#f6f2e8';
    ctx.fillRect(0, i * stripe, W, stripe);
  }
  // Blue triangle on the hoist
  ctx.fillStyle = '#1d3f9e';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(H * 0.86, H / 2); ctx.lineTo(0, H); ctx.closePath();
  ctx.fill();
  // Lone star
  drawStar(ctx, H * 0.30, H / 2, H * 0.15, H * 0.062, '#f6f2e8');
  ctx.restore();

  // Weather the paint so it looks sprayed on old plaster, not printed.
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = `rgba(232,224,207,${rnd() * 0.5})`;
    const x = rnd() * W, y = rnd() * H;
    ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 3);
  }

  ctx.font = `bold ${H * 0.1}px "Arial Black", Impact, sans-serif`;
  ctx.fillStyle = 'rgba(20,20,24,0.82)';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(W * 0.62, H * 0.5);
  ctx.rotate(-0.05);
  ctx.fillText('AQUÍ TAMBIÉN', 0, 0);
  ctx.fillText('SE WHEELEA', 0, H * 0.12);
  ctx.restore();

  return finish(canvas, 1, 1);
}

/** Painted shopfront lettering, used to break up the ground floors. */
export function makeSignTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const W = 512, H = 128;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = fg;
  ctx.font = 'bold 64px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 4);
  return finish(canvas, 1, 1);
}

/** Vertical sky gradient baked into a texture, used on a big inverted sphere. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const W = 64, H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#1963c4');
  g.addColorStop(0.35, '#4a9ade');
  g.addColorStop(0.62, '#9fd0ef');
  g.addColorStop(0.80, '#dcefff');
  g.addColorStop(1.0, '#f6f7e8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft cloud sprite for the billboard clouds on the horizon. */
export function makeCloudTexture(seed: number): THREE.CanvasTexture {
  const rnd = mulberry(seed);
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  for (let i = 0; i < 26; i++) {
    const x = S * 0.5 + (rnd() - 0.5) * S * 0.75;
    const y = S * 0.58 + (rnd() - 0.5) * S * 0.3;
    const r = S * (0.09 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makePalmFrondTexture(): THREE.CanvasTexture {
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#2f6b30';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(6, S / 2);
  ctx.quadraticCurveTo(S * 0.55, S * 0.34, S - 8, S * 0.44);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = 6 + (S - 14) * t;
    const y = S / 2 + (S * 0.34 - S / 2) * (2 * t * (1 - t) * 2) * 0.9 - t * 12;
    const len = (1 - Math.abs(t - 0.45) * 1.5) * S * 0.26;
    if (len <= 0) continue;
    ctx.strokeStyle = `rgb(${40 + i}, ${105 + (i % 5) * 8}, ${44})`;
    ctx.lineWidth = 3.5;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len * 0.35, y + dir * len * 0.45, x + len * 0.25, y + dir * len);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStar(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
