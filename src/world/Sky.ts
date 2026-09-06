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
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envSource = makeEnvironmentTexture();
  scene.environment = pmrem.fromEquirectangular(envSource).texture;
  envSource.dispose();
  pmrem.dispose();

  // --- light --------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff4de, 2.9);
  sun.position.set(-90, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  const cam = sun.shadow.camera;
  cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70;
  cam.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xcdeaff, 0xc0a382, 0.95);
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
