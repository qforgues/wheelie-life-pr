import * as THREE from 'three';
import { makeCloudTexture, makeSkyTexture, PALETTE } from './textures';
import { makeEnvironmentTexture } from '../view/geometry';

/**
 * Daytime, clear weather, midday-ish Caribbean sun. Time of day and weather are
 * deliberately fixed for the prototype - see docs/DECISIONS.md #6.
 */
export interface SkyRig {
  sun: THREE.DirectionalLight;
  group: THREE.Group;
  update(dt: number): void;
}

/**
 * Pre-filters a tiny equirect of sky-over-ground into the scene's environment
 * map. Split out and callable again because it lives in a render target: a lost
 * WebGL context takes the contents with it, and the bike goes flat matte until
 * this is re-run. Failure here costs reflections, not the game, so it is caught.
 */
export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envSource = makeEnvironmentTexture();
    scene.environment?.dispose();
    scene.environment = pmrem.fromEquirectangular(envSource).texture;
    envSource.dispose();
    pmrem.dispose();
  } catch (err) {
    console.warn('environment map unavailable', err);
    scene.environment = null;
  }
}

export function buildSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SkyRig {
  const group = new THREE.Group();

  // --- dome ---------------------------------------------------------------
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1600, 32, 20),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, depthWrite: false }),
  );
  dome.rotation.y = Math.PI * 0.3;
  group.add(dome);

  // --- clouds -------------------------------------------------------------
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: makeCloudTexture(i * 17 + 3),
      transparent: true,
      opacity: 0.55 + (i % 4) * 0.09,
      depthWrite: false,
    });
    const size = 160 + (i % 5) * 90;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.55), mat);
    const a = (i / 16) * Math.PI * 2 + 0.4;
    const r = 700 + (i % 3) * 260;
    m.position.set(Math.cos(a) * r, 190 + (i % 5) * 55, Math.sin(a) * r);
    m.lookAt(0, m.position.y * 0.4, 0);
    m.renderOrder = -1;
    clouds.push(m);
    group.add(m);
  }

  // --- sea ----------------------------------------------------------------
  const seaMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.sea),
    roughness: 0.18,
    metalness: 0.15,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -1.4, 900);
  group.add(sea);

  // A band of paler water at the shoreline so the sea doesn't read as flat paint.
  const shallow = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 90),
    new THREE.MeshStandardMaterial({ color: 0x53c9d6, roughness: 0.25, transparent: true, opacity: 0.75 }),
  );
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.set(0, -1.3, 500);
  group.add(shallow);

  scene.add(group);

  // --- image-based lighting -----------------------------------------------
  // Painted and chromed surfaces have nothing to reflect without this, so they
  // read as flat plastic however round the geometry is. A tiny equirect of sky
  // over ground, pre-filtered, is enough to give the bike a finish.
  buildEnvironment(scene, renderer);

  // --- light --------------------------------------------------------------
  // Late afternoon rather than noon.
  //
  // Overhead light is the flattest light there is - it lands on the tops of
  // things and leaves every vertical face the same brightness, which is a large
  // part of why this read as a toy. Dropping the sun rakes it down the avenues,
  // lights one side of every building and leaves the other in shade, and gives
  // the whole city long shadows to ride through. Warmer with it, because a low
  // sun IS warmer, and the grade splits the shade cool to meet it.
  const sun = new THREE.DirectionalLight(0xffe6c2, 3.2);
  sun.position.set(-118, 74, 52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  const cam = sun.shadow.camera;
  // A lower sun throws longer shadows, so the box has to reach further or they
  // get clipped off mid-street.
  cam.left = -95; cam.right = 95; cam.top = 95; cam.bottom = -95;
  cam.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // Sky fill, cooled and pulled back a little. It was doing so much of the
  // lighting that the sun had nothing left to say; a lower fill is what lets a
  // shadow read as a shadow.
  const hemi = new THREE.HemisphereLight(0xbcdcff, 0xbe9c78, 0.92);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));

  scene.fog = new THREE.Fog(0xbcd9ec, 220, 1350);

  let t = 0;
  return {
    sun,
    group,
    update(dt: number) {
      t += dt;
      // Barely-there drift so the sky isn't dead still.
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * (1.4 + (i % 3) * 0.5);
        if (clouds[i].position.x > 1500) clouds[i].position.x = -1500;
      }
      seaMat.color.setHSL(0.53, 0.72, 0.36 + Math.sin(t * 0.25) * 0.012);
    },
  };
}
