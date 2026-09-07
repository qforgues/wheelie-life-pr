import * as THREE from 'three';

/**
 * The colour grade, and why it costs nothing.
 *
 * The single biggest reason this looked like a toy was that it had no grade at
 * all: flat albedo colours, one hard sun, ACES, straight to the screen. The gap
 * between that and a film-looking game is mostly the last ten percent of the
 * pipeline, and almost none of it is geometry.
 *
 * three.js already has the hook. Every material ends its fragment shader with
 * `toneMapping( colour )`, and `THREE.CustomToneMapping` routes that to a
 * function called `CustomToneMapping` in the tonemapping chunk - which is a
 * stub returning its input. Rewriting the stub grades **every surface in the
 * game** with no extra pass, no render target, and not one byte of memory.
 * That matters more here than anywhere: the console has a hard memory ceiling
 * and a full-screen buffer at 1080p is eight megabytes.
 *
 * The grade itself is three things, in order:
 *
 *   1. ACES, as before, so the highlights still roll off rather than clipping.
 *   2. A **split tone** - shadows toward cool blue-green, highlights toward
 *      warm. This is the one that does the work. Real light is never one
 *      colour: the sun is warm and the sky filling the shadows is blue, and a
 *      renderer with a single white-ish sun loses that entirely. Putting it
 *      back is what stops every surface looking like the same plastic.
 *   3. A gentle S-curve. Contrast in the mids, without crushing the pastels -
 *      the Old San Juan colours are the point of the place and a heavy filmic
 *      crush would grey them out.
 *
 * Saturation is left almost alone on purpose. Desaturating is the lazy way to
 * look "cinematic" and it would throw away exactly what makes this city look
 * like this city.
 */
export function installGrade(renderer: THREE.WebGLRenderer): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (!chunk.includes(stub)) {
    // three.js changed the stub. Leave ACES alone rather than shipping a broken
    // shader - a wrong grade is worse than no grade.
    console.warn('grade: tone mapping hook not found, falling back to ACES');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return;
  }

  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, /* glsl */`
    vec3 CustomToneMapping( vec3 color ) {
      vec3 c = ACESFilmicToneMapping( color );

      // Split tone. Luminance decides how much of each end a pixel gets.
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 shade = vec3( 0.90, 0.965, 1.075 );
      vec3 light = vec3( 1.065, 1.012, 0.930 );
      c *= mix( shade, light, smoothstep( 0.02, 0.78, l ) );

      // S-curve. Mixed in rather than applied outright, so the mids gain
      // contrast and the ends keep their detail.
      vec3 s = c * c * ( 3.0 - 2.0 * c );
      c = mix( c, s, 0.26 );

      // A whisper more colour, not less. The pastels are the point.
      float g = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = mix( vec3( g ), c, 1.05 );

      return clamp( c, 0.0, 1.0 );
    }
  `);
  renderer.toneMapping = THREE.CustomToneMapping;
}
