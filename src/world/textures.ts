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

/**
 * The facades the city is actually painted with, chosen rather than rolled.
 *
 * The palette above has twelve colours in it and the city can only afford a
 * handful of facade textures - one material each, and after the cell bake every
 * material is a draw call in every cell that uses it. Which handful used to be
 * decided by seeding the generator and taking whatever came out, and what came
 * out was lavender, mint, acid yellow, cream and teal twice: five colours, and
 * between them **not one** of the blue, mustard, coral, terracotta or rose that
 * a street in Old San Juan is actually painted. The city read as generic
 * Caribbean pastel.
 *
 * So they are named. Blue and teal for the cool end, mustard through coral to
 * terracotta for the warm, one rose, one cream - and every one of them gets its
 * own shutter colour, because two facades with the same dark green doors read
 * as the same building twice down a street.
 *
 * Shutters are the other half of the look: deep green, navy, oxblood and indigo
 * against white trim, which is what all that ironwork sits in front of.
 */
export const SAN_JUAN_FACADES: Array<{ base: string; trim: string; shutter: string }> = [
  { base: '#7fb6cc', trim: '#ffffff', shutter: '#8c3a2e' }, // sky blue, oxblood doors
  { base: '#e9ba52', trim: '#fbf6e9', shutter: '#1f6b52' }, // mustard, green doors
  { base: '#e0776b', trim: '#ffffff', shutter: '#2f5d7c' }, // coral, navy doors
  { base: '#3ba39c', trim: '#f4ead3', shutter: '#5c4a2e' }, // teal, brown doors
  { base: '#e79cb4', trim: '#ffffff', shutter: '#3a3f6b' }, // rose, indigo doors
  { base: '#c9714c', trim: '#fbf6e9', shutter: '#2f5d7c' }, // terracotta, navy doors
  { base: '#6f9fd8', trim: '#ffffff', shutter: '#1f6b52' }, // cornflower, green doors
  { base: '#f0e0c0', trim: '#ffffff', shutter: '#8c3a2e' }, // cream, oxblood doors
];

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

/**
 * How big the textures are actually drawn, as a fraction of their design size.
 *
 * Every texture here is 512 square or thereabouts, which on the console adds up
 * to more memory than all the geometry put together - 22.9 MB against 15.3.
 * Halving it quarters that, because a texture is an area, and at a pixel ratio
 * of 1 on a TV with anisotropy already down at 2 there is nothing there to see.
 *
 * Set once at startup, before anything is generated.
 */
export let TEXTURE_SCALE = 1;
export function setTextureScale(s: number): void {
  TEXTURE_SCALE = s;
}

/**
 * A canvas at the current texture scale, with the context pre-scaled to match.
 *
 * Everything downstream keeps drawing in its own design coordinates - a 512-wide
 * facade is still laid out across 512 - and lands on whatever surface this hands
 * back. Line widths scale with it, which is what you want: a 5 px cornice on a
 * half-size canvas should be 2.5 px, not 5.
 */
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  const s = TEXTURE_SCALE;
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d')!;
  if (s !== 1) ctx.scale(s, s);
  return [c, ctx];
}

/**
 * Anisotropic filtering costs sampling bandwidth on every pixel of road, which
 * the Xbox has far less of than the dev machine. Set once at startup.
 */
export let ANISOTROPY = 16;
export function setAnisotropy(n: number): void {
  ANISOTROPY = n;
}

function finish(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = ANISOTROPY;
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

export function makeFacadeTexture(
  seed: number, floors = 3, bays = 3,
  scheme?: { base: string; trim: string; shutter: string },
): THREE.CanvasTexture {
  const rnd = mulberry(seed);
  const W = 512;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);

  // A caller that names its colours gets them; anything else still rolls, which
  // is what the one-off signs and murals want.
  const base = scheme ? scheme.base : PALETTE.facades[Math.floor(rnd() * PALETTE.facades.length)];
  const trim = scheme ? scheme.trim : PALETTE.trim[Math.floor(rnd() * PALETTE.trim.length)];
  const shutter = scheme
    ? scheme.shutter
    : PALETTE.shutters[Math.floor(rnd() * PALETTE.shutters.length)];
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

/**
 * A race number on a plate.
 *
 * The single most recognisable thing about a motocross bike is the number
 * hanging off the side of it, and a blank white rectangle reads as an unpainted
 * panel rather than a bike someone races. Cached by what it says, because every
 * distinct Texture is its own GPU upload.
 */
const NUMBER_TEXTURES = new Map<string, THREE.CanvasTexture>();

export function makeNumberTexture(
  text: string, bg = '#f2f2ee', fg = '#15161a',
): THREE.CanvasTexture {
  const key = `${text}|${bg}|${fg}`;
  const cached = NUMBER_TEXTURES.get(key);
  if (cached) return cached;

  const W = 256, H = 192;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // A thin border, the way a real plate backing is trimmed.
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 6;
  ctx.strokeRect(9, 9, W - 18, H - 18);

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Condensed and heavy - number plates are always a tight, fat face.
  ctx.font = `900 ${Math.round(H * 0.78)}px "Arial Narrow", Impact, sans-serif`;
  ctx.setTransform(1.12, 0, 0, 1, -W * 0.06, 0);
  ctx.fillText(text, W / 2, H / 2 + H * 0.04);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  NUMBER_TEXTURES.set(key, tex);
  return tex;
}

/**
 * Scrubby tropical grass.
 *
 * Everything off the road network used to be a hole you could see the sky
 * through - a pale blue void that read as fog until you rode into it. Two tones
 * of green with dirt patches and blade flecks, so it holds up both underfoot and
 * as a mass at distance.
 */
export function makeGrassTexture(): THREE.CanvasTexture {
  const rnd = mulberry(404);
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);

  ctx.fillStyle = '#4f7a35';
  ctx.fillRect(0, 0, S, S);

  // Broad tonal patches first, so it does not read as flat felt.
  for (let i = 0; i < 26; i++) {
    const r = 26 + rnd() * 52;
    ctx.fillStyle = rnd() > 0.5
      ? `rgba(96,138,58,${0.16 + rnd() * 0.2})`
      : `rgba(58,92,40,${0.16 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bare earth showing through where it gets walked on.
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(122,98,62,${0.12 + rnd() * 0.16})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, 10 + rnd() * 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // Individual blades. Cheap, and they are what stops it looking like paint.
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const h = 1.5 + rnd() * 3;
    ctx.strokeStyle = rnd() > 0.5
      ? `rgba(126,168,74,${0.25 + rnd() * 0.4})`
      : `rgba(46,74,32,${0.2 + rnd() * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 1.6, y - h);
    ctx.stroke();
  }

  return finish(canvas);
}

/**
 * Billboard artwork.
 *
 * Two hoardings that belong to this island rather than generic ad-space: the
 * Abierto? wordmark, and the bike club Justin named. Both drawn on a canvas at
 * runtime like everything else here - an external image is one more thing that
 * can fail to load on a console, and these are shapes and type.
 */
const BILLBOARDS = new Map<string, THREE.CanvasTexture>();

/** The Abierto? wordmark: teal script, a cyan wave over it, a gold swoosh under. */
export function makeAbiertoBillboard(): THREE.CanvasTexture {
  const cached = BILLBOARDS.get('abierto');
  if (cached) return cached;

  const W = 1024, H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  // White ground: it is a painted sign, not a backlit one.
  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  // The wave across the top, two overlapping strokes with a break in them.
  ctx.strokeStyle = '#31b6cc';
  ctx.lineCap = 'round';
  for (const [y, w, x0, x1] of [[104, 26, 250, 620], [86, 20, 560, 860]] as const) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y + 16);
    ctx.bezierCurveTo(x0 + 90, y - 26, x0 + 170, y + 40, x1, y - 6);
    ctx.stroke();
  }
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(880, 66);
  ctx.lineTo(936, 58);
  ctx.stroke();

  // The wordmark. A script face if the platform has one, italic serif if not.
  const label = 'Abierto?';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 900 250px "Brush Script MT", "Snell Roundhand", Georgia, serif';
  // Pale keyline first, then the teal fill on top of it.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0d5f5c';
  ctx.lineWidth = 12;
  ctx.strokeText(label, W / 2, H / 2 + 6);
  ctx.fillStyle = '#1a8f8a';
  ctx.fillText(label, W / 2, H / 2 + 6);

  // The gold swoosh underlining it.
  ctx.strokeStyle = '#f0a92b';
  ctx.lineWidth = 34;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(150, 430);
  ctx.bezierCurveTo(330, 470, 620, 372, 900, 352);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  BILLBOARDS.set('abierto', tex);
  return tex;
}

/** VQS Bike Club - Los Piratas. Vieques, and the flag they ride under. */
export function makePiratasBillboard(): THREE.CanvasTexture {
  const cached = BILLBOARDS.get('piratas');
  if (cached) return cached;

  const W = 1024, H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const rnd = mulberry(66);

  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  // A weathered wash, so it reads as a board that has been up a while.
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.045})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }

  ctx.strokeStyle = '#e0a13a';
  ctx.lineWidth = 8;
  ctx.strokeRect(26, 26, W - 52, H - 52);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#5edbe9';
  ctx.font = '700 58px Impact, "Arial Narrow", sans-serif';
  ctx.fillText('VQS BIKE CLUB', W / 2, 116);

  // The name, big.
  ctx.font = '900 170px Impact, "Arial Narrow", sans-serif';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 16;
  ctx.strokeText('LOS PIRATAS', W / 2, 250);
  ctx.fillStyle = '#f2f2ee';
  ctx.fillText('LOS PIRATAS', W / 2, 250);

  // Crossed bones under it - a pirate mark without drawing a skull badly.
  ctx.strokeStyle = '#f2f2ee';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - dir * 96, 352);
    ctx.lineTo(W / 2 + dir * 96, 404);
    ctx.stroke();
  }
  for (const [x, y] of [[W / 2 - 96, 352], [W / 2 + 96, 352], [W / 2 - 96, 404], [W / 2 + 96, 404]]) {
    ctx.fillStyle = '#f2f2ee';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#e0a13a';
  ctx.font = '700 44px Impact, "Arial Narrow", sans-serif';
  ctx.fillText('VIEQUES  ·  PUERTO RICO', W / 2, 452);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  BILLBOARDS.set('piratas', tex);
  return tex;
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
/**
 * A soft round blob, used as a fake contact shadow.
 *
 * The low quality tier turns real shadow mapping off, which is the right call
 * on the Xbox - but without any shadow at all the bike reads as floating a foot
 * above the road, and the sense of where the wheels are is most of what selling
 * a wheelie depends on. One 128px alpha blob costs nothing and puts it back.
 */
export function makeBlobShadowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
  // Drawn base-at-left, tip-at-right, so a frond plane can be positioned by its
  // base and swung around the trunk.
  const rnd = mulberry(31);
  const W = 512, H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  const midY = H * 0.5;
  // Spine arcs up then droops toward the tip.
  const spine = (t: number) => midY - Math.sin(t * Math.PI) * H * 0.16 + t * t * H * 0.20;

  const leaflets = 46;
  for (let i = 0; i < leaflets; i++) {
    const t = i / (leaflets - 1);
    const x = 18 + (W - 40) * t;
    const y = spine(t);
    // Long in the middle, short at both ends - that taper is what reads as a
    // palm frond rather than a feather.
    const taper = Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.75;
    const len = taper * H * 0.42 * (0.85 + rnd() * 0.3);
    if (len < 3) continue;
    const shade = 34 + Math.floor(rnd() * 22) + Math.floor(t * 26);
    ctx.strokeStyle = `rgb(${shade}, ${96 + Math.floor(rnd() * 34) - Math.floor(t * 18)}, ${46 + Math.floor(rnd() * 14)})`;
    ctx.lineWidth = 4.2 - t * 1.4;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      // Swept back toward the tip, and drooping away from the spine.
      ctx.quadraticCurveTo(
        x + len * 0.30, y + dir * len * 0.40,
        x + len * 0.52, y + dir * len,
      );
      ctx.stroke();
    }
  }

  // Spine over the top.
  ctx.strokeStyle = '#4a7a34';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(14, spine(0));
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    ctx.lineTo(18 + (W - 40) * t, spine(t));
  }
  ctx.stroke();

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

/**
 * Chain link, drawn as one tile of diamond mesh with a strand of barbed wire
 * along the top.
 *
 * The fence round the edge of the map is two and a half kilometres long, so it
 * has to be a texture and not geometry: one alpha-tested quad per panel is two
 * triangles, where wire modelled as boxes would be tens of thousands. Alpha
 * TEST rather than blend, so there is no sorting to get wrong and no cost to
 * having it in front of the whole city.
 *
 * The tile covers 1.2 m of fence, and the top eighth is the barbed wire, which
 * is why the panel geometry uses the same proportion.
 */
export function makeChainLinkTexture(): THREE.CanvasTexture {
  // The canvas is the SHAPE of a panel, not a square. A square tile stretched
  // over a 1.2 x 2.6 m panel gives diamonds twice as tall as they are wide,
  // which reads as netting rather than chain link. 256 px across 1.2 m is
  // 213 px/m, so the height follows from the panel height.
  const S = 256;
  const H = Math.round(S * (2.6 / 1.2));
  const [c, ctx] = makeCanvas(S, H);
  ctx.clearRect(0, 0, S, H);

  // Barbed wire lives along the top; the mesh fills the rest.
  const top = H * 0.15;
  const cell = S / 8;
  ctx.strokeStyle = '#b9c0c6';
  ctx.lineWidth = 3.0;
  ctx.lineCap = 'square';
  // Two sets of diagonals make the diamonds. Drawn well past the edges so the
  // tile joins itself cleanly when it repeats.
  // Drawn at 45 degrees on a square-pixel canvas, so the diamonds come out
  // square. Extended well past both edges so the tile joins itself when it
  // repeats along the run.
  const span = H - top;
  for (let i = -24; i <= 24; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, top);
    ctx.lineTo(i * cell + span, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * cell, top);
    ctx.lineTo(i * cell - span, H);
    ctx.stroke();
  }
  // A darker second pass one pixel down reads as the wire having a round
  // section rather than being a flat line.
  ctx.strokeStyle = 'rgba(60, 68, 76, 0.55)';
  ctx.lineWidth = 1.4;
  for (let i = -24; i <= 24; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell + 1.4, top + 1.4);
    ctx.lineTo(i * cell + 1.4 + span, H + 1.4);
    ctx.stroke();
  }

  // The arms that carry the wire, leaning out from each post, then the top
  // rail, then three strands.
  //
  // These are drawn heavy on purpose. At 2.4 px they aliased away at any
  // distance and the top fifth of the fence read as a gap above the mesh
  // rather than as barbed wire - which made the whole thing look broken.
  ctx.strokeStyle = '#9aa2a9';
  ctx.lineWidth = 5;
  for (let i = 0; i <= 2; i++) {
    const x = (i * S) / 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + 18, 4);
    ctx.stroke();
  }
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(S, top);
  ctx.stroke();
  ctx.strokeStyle = '#a4acb3';
  ctx.lineWidth = 4.5;
  for (const y of [top * 0.66, top * 0.40, top * 0.14]) {
    ctx.beginPath();
    ctx.moveTo(0, y + 6);
    ctx.lineTo(S, y);
    ctx.stroke();
    // Barbs, every sixth of a tile.
    for (let x = 8; x < S; x += S / 6) {
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 7);
      ctx.lineTo(x + 7, y + 7);
      ctx.moveTo(x + 7, y - 7);
      ctx.lineTo(x - 7, y + 7);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A crew plate for the back of a helmet: letters over a striped flag.
 *
 * Justin's idea, near enough his words - VQS with a white and light-blue
 * striped flag behind the letters. Cached by what it says, because a texture
 * per rider is a GPU upload per rider and that is the mistake this file has
 * already made twice.
 *
 * Deliberately a flag rather than a logo: at helmet size from a chase camera
 * the stripes are what you actually read, and the letters sit on top of them.
 */
const CREW_DECALS = new Map<string, THREE.CanvasTexture>();

/**
 * Draws one of Justin's crew shapes, centred in a box of `r` half-size.
 *
 * Kept to primitives on purpose: at helmet size behind a moving bike a shape
 * has about forty pixels to make itself understood, so a silhouette that reads
 * instantly beats detail that does not survive the trip.
 */
function crewShape(
  ctx: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number,
): void {
  ctx.beginPath();
  if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.44;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === 'bolt') {
    const p: Array<[number, number]> = [
      [0.18, -1], [-0.62, 0.08], [-0.10, 0.08], [-0.28, 1], [0.62, -0.14],
      [0.08, -0.14],
    ];
    p.forEach(([x, y], i) => {
      const px = cx + x * r;
      const py = cy + y * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.closePath();
  } else if (shape === 'crown') {
    const p: Array<[number, number]> = [
      [-1, 0.62], [-1, -0.55], [-0.5, 0.02], [0, -0.72], [0.5, 0.02], [1, -0.55],
      [1, 0.62],
    ];
    p.forEach(([x, y], i) => {
      const px = cx + x * r;
      const py = cy + y * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.closePath();
  } else if (shape === 'flag') {
    ctx.rect(cx - r * 0.92, cy - r * 0.62, r * 1.84, r * 1.24);
  } else if (shape === 'anchor') {
    ctx.arc(cx, cy - r * 0.62, r * 0.26, 0, Math.PI * 2);
    ctx.rect(cx - r * 0.12, cy - r * 0.5, r * 0.24, r * 1.4);
    ctx.rect(cx - r * 0.62, cy - r * 0.16, r * 1.24, r * 0.22);
    ctx.moveTo(cx - r * 0.86, cy + r * 0.34);
    ctx.quadraticCurveTo(cx, cy + r * 1.15, cx + r * 0.86, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.6, cy + r * 0.30);
    ctx.quadraticCurveTo(cx, cy + r * 0.82, cx - r * 0.6, cy + r * 0.30);
    ctx.closePath();
  } else {
    // calavera: a dome, a jaw, and two sockets punched back out.
    ctx.arc(cx, cy - r * 0.16, r * 0.78, Math.PI, 0);
    ctx.rect(cx - r * 0.78, cy - r * 0.16, r * 1.56, r * 0.72);
    ctx.rect(cx - r * 0.34, cy + r * 0.56, r * 0.68, r * 0.34);
  }
  ctx.fill();
  if (shape === 'skull') {
    // Sockets, in whatever is behind the ink.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const dx of [-0.34, 0.34]) {
      ctx.beginPath();
      ctx.arc(cx + dx * r, cy - r * 0.16, r * 0.23, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.rect(cx - r * 0.09, cy + r * 0.06, r * 0.18, r * 0.24);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A crew plate: Justin's shape and his letters over his colour.
 *
 * The shape sits behind the name rather than beside it, because at the size
 * this is actually seen - the back of a helmet, from a chase camera - two
 * things side by side become one smudge and one thing behind another still
 * reads as two.
 */
export function makeCrewPlate(
  name: string, hex: string, ink: string, shape: string,
): THREE.CanvasTexture {
  const key = `plate|${name}|${hex}|${ink}|${shape}`;
  const had = CREW_DECALS.get(key);
  if (had) return had;

  const W = 256;
  const H = 160;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, W, H);
  // The shape, watermarked into the colour so the letters stay first.
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = ink;
  crewShape(ctx, shape, W / 2, H * 0.5, H * 0.44);
  ctx.restore();
  // Edge shading, so the plate has a form rather than being a flat sticker.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Shrink to fit rather than guessing from the letter count. A guess is fine
  // for LOS PIRATAS and runs off both ends of the plate for LOS TIBURONES, and
  // the whole point of this is that Justin can call it whatever he likes.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fits = W * 0.88;
  let size = H * 0.54;
  for (; size > H * 0.18; size -= 2) {
    ctx.font = `900 ${Math.round(size)}px Impact, "Arial Black", system-ui, sans-serif`;
    if (ctx.measureText(name).width <= fits) break;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.20;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(name, W / 2, H * 0.53);
  ctx.fillStyle = ink;
  ctx.fillText(name, W / 2, H * 0.53);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  CREW_DECALS.set(key, tex);
  return tex;
}

export function makeCrewDecal(text: string, a: string, b: string, ink: string): THREE.CanvasTexture {
  const key = `${text}|${a}|${b}|${ink}`;
  const had = CREW_DECALS.get(key);
  if (had) return had;

  const W = 256;
  const H = 160;
  const [c, ctx] = makeCanvas(W, H);

  // The flag: stripes running across, with the edge frayed off so it reads as
  // cloth behind the letters rather than a snooker table.
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect(0, (i * H) / bands, W, H / bands + 1);
  }
  // A soft darkening at the edges so the plate has a shape.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0.30)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // The letters, with a heavy outline so they hold together at distance.
  ctx.font = `900 ${Math.round(H * 0.62)}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = H * 0.11;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, W / 2, H * 0.54);
  ctx.fillStyle = ink;
  ctx.fillText(text, W / 2, H * 0.54);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  CREW_DECALS.set(key, tex);
  return tex;
}

/**
 * A speed limit plate: the number, big, on white, in a black border.
 *
 * Cached by the number, because there are three of them in the whole city and
 * a canvas per sign is the mistake this file has already made twice.
 */
const SPEED_TEXTURES = new Map<number, THREE.CanvasTexture>();

export function makeSpeedTexture(mph: number): THREE.CanvasTexture {
  const had = SPEED_TEXTURES.get(mph);
  if (had) return had;
  const W = 200;
  const H = 256;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#16181d';
  ctx.lineWidth = 13;
  ctx.strokeRect(11, 11, W - 22, H - 22);
  ctx.fillStyle = '#16181d';
  ctx.textAlign = 'center';
  ctx.font = `700 30px "Helvetica Neue", Arial, system-ui, sans-serif`;
  ctx.fillText('SPEED', W / 2, 62);
  ctx.fillText('LIMIT', W / 2, 92);
  ctx.font = `800 104px "Helvetica Neue", Arial, system-ui, sans-serif`;
  ctx.fillText(String(mph), W / 2, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  SPEED_TEXTURES.set(mph, tex);
  return tex;
}
