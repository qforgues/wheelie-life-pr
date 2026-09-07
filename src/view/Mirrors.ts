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
    this.ortho.left = 0;
    this.ortho.right = width;
    this.ortho.bottom = 0;
    this.ortho.top = height;
    this.ortho.updateProjectionMatrix();

    this.group.clear();
    // Sized off the viewport so it holds up from a sofa as well as a desk.
    const w = Math.max(74, Math.min(132, width * 0.095));
    const h = w * 0.6;
    const margin = Math.max(14, width * 0.018);
    // The HUD reads this to place itself below the mirror rather than under it.
    document.documentElement.style.setProperty(
      '--mirror-h', `${this.enabled ? Math.round(margin + h) : 0}px`,
    );

    for (const side of [-1, 1] as const) {
      const x = side < 0 ? margin : width - margin - w;
      const y = height - margin - h;
      this.group.add(this.buildMirror(x, y, w, h, side));
    }
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
    // Each mirror sees its own half of the shared rear view.
    mapUV(glassGeo, side < 0 ? 0 : 0.5, side < 0 ? 0.5 : 1, true);
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
    this.camera.position.set(
      x + Math.sin(yaw) * 0.72,
      y + 1.34,
      z + Math.cos(yaw) * 0.72,
    );
    // Behind, not in front.
    this.camera.rotation.set(0, yaw + Math.PI, 0, 'YXZ');
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
