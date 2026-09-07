import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Bloom, vignette and grain — the half of the lens that needs a buffer.
 *
 * The grade is free because it hides inside every material's tone mapping step
 * (see grade.ts). These three cannot be: bloom has to look at neighbouring
 * pixels, so it needs the frame in a texture first, and a full-screen buffer at
 * 1080p is eight megabytes before the bloom's own mip chain on top.
 *
 * **So the console does not get this.** The Xbox has a hard memory ceiling it
 * has already been over once, and eleven megabytes of render targets to make
 * lights glow is the wrong trade there. It keeps the grade, the low sun and the
 * long shadows, which is most of the benefit for none of the memory. This is
 * what the quality tiers are for.
 *
 * Bloom is deliberately restrained. The temptation is to crank it until
 * everything smears, which reads as a cheap filter; at this strength it only
 * catches what is genuinely bright - the sun off paint, a light bar, a brake
 * light coming on - which is exactly what a camera does.
 */
const FINAL = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.38 },
    grain: { value: 0.035 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D( tDiffuse, vUv );

      // Vignette. Corners down, and very slightly cooler with it, because a
      // real lens loses a little warmth at the edge as well as light.
      vec2 d = vUv - 0.5;
      float r = dot( d, d );
      float fall = 1.0 - vignette * r * 1.9;
      c.rgb *= clamp( fall, 0.0, 1.0 );
      c.rgb = mix( c.rgb, c.rgb * vec3( 0.97, 0.99, 1.03 ), clamp( r * 2.4, 0.0, 1.0 ) );

      // Grain, animated so it does not read as dirt on the screen. Scaled by
      // how dark the pixel is: film grain lives in the shadows, and putting it
      // in the highlights just looks like noise.
      float n = fract( sin( dot( vUv * 1024.0 + time, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      float lum = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      c.rgb += ( n - 0.5 ) * grain * ( 1.0 - lum * 0.75 );

      gl_FragColor = c;
    }`,
};

export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private clock = 0;

  constructor(
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
    strength: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold high, and it needs to be. At 0.82 the sunlit pavement was over
    // the line, so every kerb in the city glowed like a strip light - which
    // reads as a bug, not as a lens. At 0.95 only things that are genuinely
    // near-white or emissive bloom: the brake light, a light bar, the sun off
    // a tank. Radius wide and strength low with it, for a soft halo rather than
    // a hard glow.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), strength, 0.9, 0.95,
    );
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FINAL);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
  }

  setCamera(camera: THREE.Camera): void {
    const pass = this.composer.passes[0] as RenderPass;
    pass.camera = camera;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render(dt: number): void {
    this.clock += dt;
    this.final.uniforms.time.value = this.clock * 12;
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
