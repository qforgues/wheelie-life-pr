import * as THREE from 'three';

/**
 * Bar-end mirrors, top left and top right.
 *
 * A motorcycle's mirrors are the only way to see a patrol car closing on you,
 * and on a bike they sit right where these do - out at the ends of the bars, in
 * the top corners of your view.
 *
 * The cost matters more than the look. Two mirrors could mean two extra passes
 * over the whole city every frame, which is three renders a frame on a console
 * that was already out of memory once. Instead there is **one** wide rear view
 * into a small target, and each mirror samples a different half of it - which is
 * close to what two outward-angled mirrors actually show. It renders at half
 * frame rate and with a short far plane, so most of the city frustum-culls out
 * of the pass entirely.
 */

/** How far back a mirror can see. Short on purpose - it is a cheap pass. */
const MIRROR_FAR = 140;
/** Horizontal field of view across BOTH mirrors combined. */
const MIRROR_FOV = 96;

/**
 * Where the mirrors hang.
 *
 * `corners` puts them in the screen corners, which is easy to read but is a HUD
 * element rather than part of the bike. `bike` puts them out where a rider's
 * actual mirrors are - up and out from the bars, sitting in the top of the view
 * rather than the very edge of the screen - which is what sells the seat.
 */
export type MirrorMount = 'corners' | 'bike' | 'off';

export const MOUNT_ORDER: MirrorMount[] = ['corners', 'bike', 'off'];
export const MOUNT_LABELS: Record<MirrorMount, string> = {
  corners: 'CORNERS',
  bike: 'ON THE BIKE',
  off: 'OFF',
};
export const MOUNT_BLURBS: Record<MirrorMount, string> = {
  corners: 'Tucked into the screen corners, out of the way.',
  bike: 'Out on the bars, where a rider would actually glance.',
  off: 'No mirrors. Look over your shoulder.',
};

export function isMirrorMount(v: unknown): v is MirrorMount {
  return v === 'corners' || v === 'bike' || v === 'off';
}

/**
 * Trim range, as a fraction of the viewport, per mirror.
 *
 * Wide open in both axes so a mirror can go anywhere that is useful - the only
 * rule enforced is that the left mirror can never cross the right one, which
 * would leave you reading the wrong side of the road.
 */
export const AIM_LIMIT = { x: 0.42, y: 0.40 };

export interface MirrorAim {
  lx: number; ly: number;
  rx: number; ry: number;
}

export const DEFAULT_AIM: MirrorAim = { lx: 0, ly: 0, rx: 0, ry: 0 };

export class Mirrors {
  private target: THREE.WebGLRenderTarget;
  private camera: THREE.PerspectiveCamera;
  private overlay = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private glassMat: THREE.MeshBasicMaterial;
  private group = new THREE.Group();
  private frame = 0;

  /** Off on the lowest tier, where the extra pass is not affordable. */
  enabled = true;
  mount: MirrorMount = 'corners';
  /** Rider trim per mirror, each -1..1. */
  aim: MirrorAim = { ...DEFAULT_AIM };
  /** True while the chase camera is in the rider's own view. */
  firstPerson = false;

  private lastW = 0;
  private lastH = 0;

  constructor(resolution = 512) {
    this.target = new THREE.WebGLRenderTarget(resolution, Math.round(resolution * 0.4), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });

    this.camera = new THREE.PerspectiveCamera(52, 2.5, 0.5, MIRROR_FAR);

    this.glassMat = new THREE.MeshBasicMaterial({ map: this.target.texture });
    this.overlay.add(this.group);
  }

  /** Rebuilds the mirror quads for a new viewport size. */
  setSize(width: number, height: number): void {
    this.lastW = width;
    this.lastH = height;
    this.ortho.left = 0;
    this.ortho.right = width;
    this.ortho.bottom = 0;
    this.ortho.top = height;
    this.ortho.updateProjectionMatrix();

    // clear() detaches but does not free; these quads are rebuilt every resize
    // and every aim nudge, so without this the scene accumulates them.
    for (const m of this.group.children) {
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    }
    this.group.clear();
    if (this.mount === 'off') {
      document.documentElement.style.setProperty('--mirror-h', '0px');
      return;
    }

    // Sized off the viewport so it holds up from a sofa as well as a desk.
    const w = Math.max(74, Math.min(132, width * 0.095));
    const h = w * 0.6;
    const margin = Math.max(14, width * 0.018);

    // Corner mount hugs the screen edges. Bike mount brings them well inboard
    // and down to where bar-end mirrors actually sit in the rider's view, and
    // further again in first person, where the bars are closer to your face.
    const inset = this.mount === 'bike'
      ? (this.firstPerson ? width * 0.34 : width * 0.26)
      : 0;
    const drop = this.mount === 'bike'
      ? (this.firstPerson ? height * 0.30 : height * 0.20)
      : 0;

    const baseL = margin + inset;
    const baseR = width - margin - w - inset;
    const baseY = height - margin - h - drop;

    let lx = baseL + this.aim.lx * AIM_LIMIT.x * width;
    let rx = baseR + this.aim.rx * AIM_LIMIT.x * width;
    const ly = baseY + this.aim.ly * AIM_LIMIT.y * height;
    const ry = baseY + this.aim.ry * AIM_LIMIT.y * height;

    // The one hard rule: left stays left of right, with a gap between them.
    const GAP = w * 0.35;
    if (lx + w + GAP > rx) {
      const middle = (lx + w + GAP + rx) / 2;
      lx = middle - w - GAP / 2;
      rx = middle + GAP / 2;
    }
    // And neither may leave the screen.
    const clampX = (v: number) => Math.max(0, Math.min(width - w, v));
    const clampY = (v: number) => Math.max(0, Math.min(height - h, v));

    this.group.add(this.buildMirror(clampX(lx), clampY(ly), w, h, -1));
    this.group.add(this.buildMirror(clampX(rx), clampY(ry), w, h, 1));

    // The HUD reads this to place itself below the mirror rather than under it,
    // but only when a mirror is actually sitting in the top-left corner.
    const leftInCorner = this.mount === 'corners' && clampX(lx) < width * 0.25;
    // The overlay camera has y = 0 at the BOTTOM, so the CSS distance from the
    // top of the screen down to the mirror's lower edge is `height - y` - NOT
    // `y + h`, which is measured from the wrong end and came out at 815px on an
    // 840px screen. That pushed the whole stats block off the bottom.
    const belowMirror = height - clampY(ly);
    // Never allow this to shove the HUD somewhere it cannot be seen, whatever
    // the arithmetic says.
    const offset = leftInCorner ? Math.round(Math.min(belowMirror, height * 0.3)) : 0;
    document.documentElement.style.setProperty('--mirror-h', `${offset}px`);
  }

  /** Changes where the mirrors hang and rebuilds them in place. */
  setMount(mount: MirrorMount): void {
    this.mount = mount;
    this.enabled = mount !== 'off';
    if (this.lastW) this.setSize(this.lastW, this.lastH);
  }

  /** Rider trim, per mirror, each axis -1..1. */
  setAim(aim: MirrorAim): void {
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    this.aim = { lx: c(aim.lx), ly: c(aim.ly), rx: c(aim.rx), ry: c(aim.ry) };
    if (this.lastW) this.setSize(this.lastW, this.lastH);
  }

  /** First person pulls them in and down, where the bars actually are. */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    if (this.lastW) this.setSize(this.lastW, this.lastH);
  }

  /**
   * One mirror: a glass panel in a dark bezel on a short stalk.
   *
   * `side` -1 is the left mirror, which shows the left half of the rear view.
   * The horizontal flip is what makes it read as a mirror rather than as a
   * camera pointed backwards - in a mirror, traffic passing on your right
   * appears on the right of the glass.
   */
  private buildMirror(
    x: number, y: number, w: number, h: number, side: -1 | 1,
  ): THREE.Group {
    const g = new THREE.Group();

    // Stalk, angled in toward where the bars would be.
    const stalkW = w * 0.09;
    const stalk = new THREE.Mesh(
      new THREE.PlaneGeometry(stalkW, h * 0.42),
      new THREE.MeshBasicMaterial({ color: 0x14161c }),
    );
    stalk.position.set(
      x + (side < 0 ? w * 0.72 : w * 0.28),
      y - h * 0.14,
      -0.2,
    );
    stalk.rotation.z = side * 0.28;
    g.add(stalk);

    const bezelPad = Math.max(3, w * 0.035);
    const bezel = new THREE.Mesh(
      roundedPlane(w + bezelPad * 2, h + bezelPad * 2, (h + bezelPad * 2) * 0.42),
      new THREE.MeshBasicMaterial({ color: 0x0d0f14 }),
    );
    bezel.position.set(x + w / 2, y + h / 2, -0.1);
    g.add(bezel);

    const glassGeo = roundedPlane(w, h, h * 0.4);

    // Which half of the shared rear view each mirror shows.
    //
    // The camera looks backward, which is a three.js camera's default
    // orientation, so its screen-right is world +X. The rider's right is -X.
    // Everything to the rider's rear-LEFT therefore lands in the RIGHT half of
    // that render - so the left mirror takes the right half, and vice versa.
    // Getting this the obvious way round put cars that were behind you on the
    // left into your right mirror.
    //
    // The horizontal flip on top is what turns a rear-facing camera into a
    // mirror: outer edge of the glass looks wide, inner edge looks back along
    // your own bike, which is how a wing mirror reads.
    const u0 = side < 0 ? 0.5 : 0;
    const u1 = side < 0 ? 1 : 0.5;
    mapUV(glassGeo, u0, u1, true);
    const glass = new THREE.Mesh(glassGeo, this.glassMat);
    glass.position.set(x + w / 2, y + h / 2, 0);
    g.add(glass);

    return g;
  }

  /**
   * Points the rear camera. Sits where a rider's mirrors would, looking back
   * past their own shoulder.
   */
  place(x: number, y: number, z: number, yaw: number): void {
    // Mounted out at the bars, ahead of the rider and above the tank - which is
    // where they live on a real bike, and far enough forward that the view is
    // the street rather than the back of the rider's own jacket.
    const cx = x + Math.sin(yaw) * 0.72;
    const cz = z + Math.cos(yaw) * 0.72;
    this.camera.position.set(cx, y + 1.34, cz);

    // Aimed with lookAt at a point down the road BEHIND the bike, rather than
    // by setting an Euler angle. A three.js camera looks along its own -Z and
    // the bike faces +Z, so `yaw + PI` - the intuitive "turn it around" - aims
    // it straight down the road ahead, and the mirrors showed the view in
    // front. A target you can name cannot be off by half a turn.
    this.camera.lookAt(
      cx - Math.sin(yaw) * 20,
      y + 1.05,
      cz - Math.cos(yaw) * 20,
    );
    this.camera.fov = MIRROR_FOV / 2;
    this.camera.aspect = 2.5;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Draws the rear view into the target, then the mirrors over the frame.
   *
   * Call after the main scene. `autoClear` is left off for the overlay so the
   * game underneath survives, and the depth buffer is cleared so the mirrors
   * always sit on top of it.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.enabled) return;

    // Half rate. A mirror updating at 30 fps is indistinguishable in motion and
    // halves what is the single most expensive thing on this frame.
    this.frame++;
    if (this.frame % 2 === 0) {
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, this.camera);
      renderer.setRenderTarget(prevTarget);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.overlay, this.ortho);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** A rounded rectangle in the XY plane, centred on the origin. */
function roundedPlane(w: number, h: number, radius: number): THREE.ShapeGeometry {
  const r = Math.min(radius, w / 2, h / 2);
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(shape, 8);
}

/**
 * Rewrites a shape's UVs to sample a horizontal slice of the render target.
 *
 * ShapeGeometry hands back UVs in the shape's own coordinates, which here are
 * pixels - so they have to be normalised before they mean anything.
 */
function mapUV(geo: THREE.ShapeGeometry, u0: number, u1: number, flip: boolean): void {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const spanX = bb.max.x - bb.min.x || 1;
  const spanY = bb.max.y - bb.min.y || 1;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    let u = (pos.getX(i) - bb.min.x) / spanX;
    const v = (pos.getY(i) - bb.min.y) / spanY;
    if (flip) u = 1 - u;
    uv[i * 2] = u0 + u * (u1 - u0);
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
