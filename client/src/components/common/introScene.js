// Three.js scene for the AAYUSH CARTING intro: a loaded heavy-duty tipper truck arriving at a brick yard.
// Everything is built procedurally (no downloaded models or images): rounded-box geometry, clear-coat paint, glass with
// environment reflections, rubber tyres with steel rims, instanced clay bricks with a generated grain texture, soft
// shadows and contact shadows. IntroAnimation.jsx drives it with GSAP; this file only builds, resizes, renders and disposes.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export const TRUCK_START_X = 24; // local x, off-screen to the right (the layout slot decides where "0" is)
export const TRUCK_FINAL_X = 0;
export const JCB_START_X = 24; // local x, off-screen to the right: the JCB drives in right-to-left like the truck
export const WHEEL_RADIUS = 0.62;

const COLOR = {
  charcoal: "#252B30",
  charcoalSoft: "#343b42",
  white: "#EEEEEA",
  orange: "#E07A2F",
  steel: "#B9BEC3",
  rubber: "#17191b",
  glass: "#22303a",
};
const BRICK_TONES = ["#B4523A", "#C0603F", "#A84A34", "#C96B47", "#B85B3D", "#AF5236", "#C4644A"];

// small deterministic random so the brick pattern is the same on every load
const makeRandom = (seed) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function makeBrickTexture(rand) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e4e4e4";
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 9000; i += 1) {
    const v = 150 + Math.floor(rand() * 105);
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + rand() * 0.5})`;
    g.fillRect(rand() * 256, rand() * 128, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 26; i += 1) {
    g.fillStyle = `rgba(90,90,90,${0.05 + rand() * 0.08})`;
    g.beginPath();
    g.ellipse(rand() * 256, rand() * 128, 6 + rand() * 18, 3 + rand() * 9, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeBlobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(20,22,25,0.85)");
  grad.addColorStop(0.55, "rgba(20,22,25,0.35)");
  grad.addColorStop(1, "rgba(20,22,25,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function createIntroScene(host) {
  const rand = makeRandom(20260);
  const disposables = [];
  const track = (o) => {
    disposables.push(o);
    return o;
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.info.autoReset = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  // Desktop uses a perspective camera; tablet and mobile use an orthographic one so models keep a consistent size
  // when they are stacked in rows (no perspective shrink for the row that is further away).
  const persp = new THREE.PerspectiveCamera(22, 2, 0.5, 160);
  const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.5, 160);
  let camera = persp;
  const lowPower = host.clientWidth < 640 || (window.matchMedia?.("(pointer: coarse)").matches ?? false);

  // ---- lighting: warm key light with soft shadow, cool fill from the hemisphere ----
  const key = new THREE.DirectionalLight("#fff3e2", 2.4);
  key.position.set(-6, 14, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 1536, lowPower ? 1024 : 1536);
  renderer.shadowMap.autoUpdate = false; // shadows are re-rendered only on frames where something moved (see render())
  Object.assign(key.shadow.camera, { left: -20, right: 20, top: 17, bottom: -17, near: 1, far: 50 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  scene.add(new THREE.HemisphereLight("#ffffff", "#d9d3c8", 0.55));

  const world = new THREE.Group(); // everything visible; GSAP moves it slightly on exit
  scene.add(world);

  // ---- materials ----
  const std = (color, o = {}) => track(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o }));
  const paint = (color, o = {}) =>
    track(new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, metalness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.22, ...o }));
  const M = {
    white: paint(COLOR.white),
    charcoal: paint(COLOR.charcoal, { roughness: 0.45 }),
    charcoalSoft: std(COLOR.charcoalSoft, { roughness: 0.55, metalness: 0.4 }),
    orange: paint(COLOR.orange, { roughness: 0.4 }),
    steel: std(COLOR.steel, { roughness: 0.32, metalness: 0.85 }),
    rubber: std(COLOR.rubber, { roughness: 0.95 }),
    glass: track(new THREE.MeshPhysicalMaterial({ color: COLOR.glass, roughness: 0.05, metalness: 0.55, clearcoat: 1, envMapIntensity: 1.6 })),
    lamp: std("#fff6df", { emissive: "#ffe3a8", emissiveIntensity: 0.9, roughness: 0.2 }),
  };

  const rbox = (w, h, d, m, r, x, y, z) => {
    const rad = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    const mesh = new THREE.Mesh(track(new RoundedBoxGeometry(w, h, d, 2, rad)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const cyl = (rt, rb, h, m, seg = 24) => {
    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(rt, rb, h, seg)), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // Merge the static meshes directly inside a group into one mesh per material: far fewer draw calls (every call is made
  // twice, once for the shadow map). Spinning wheels and moving arms are separate groups, so they are left alone.
  const bake = (group) => {
    group.updateMatrixWorld(true);
    const byMat = new Map();
    group.children
      .filter((c) => c.isMesh && !c.isInstancedMesh)
      .forEach((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); // rounded boxes are non-indexed, tubes are indexed
        g.applyMatrix4(m.matrix);
        if (!byMat.has(m.material)) byMat.set(m.material, { list: [], cast: m.castShadow, receive: m.receiveShadow });
        byMat.get(m.material).list.push(g);
        group.remove(m);
        m.geometry.dispose();
      });
    byMat.forEach(({ list, cast, receive }, mat) => {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      track(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      group.add(mesh);
    });
  };

  // ---- bricks: one shared geometry, grain texture, per-instance tone and tiny placement jitter ----
  const BL = 0.5;
  const BH = 0.17;
  const BW = 0.24;
  const brickGeo = track(new RoundedBoxGeometry(BL, BH, BW, 1, 0.014));
  const grain = track(makeBrickTexture(rand));
  const brickMat = std("#ffffff", { map: grain, bumpMap: grain, bumpScale: 1.4, roughness: 0.93 });
  const stackMat = brickMat.clone();
  track(stackMat);
  const tone = new THREE.Color();
  const dummy = new THREE.Object3D();
  const placeBricks = (list, material) => {
    const mesh = new THREE.InstancedMesh(brickGeo, material, list.length);
    list.forEach((b, i) => {
      dummy.position.set(b.x + (rand() - 0.5) * 0.012, b.y, b.z + (rand() - 0.5) * 0.012);
      dummy.rotation.set((rand() - 0.5) * 0.02, b.ry + (rand() - 0.5) * 0.035, (rand() - 0.5) * 0.02);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tone.set(BRICK_TONES[Math.floor(rand() * BRICK_TONES.length)]).multiplyScalar(0.9 + rand() * 0.2);
      mesh.setColorAt(i, tone);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ---- ground: invisible plane that only catches shadows, plus soft contact blobs ----
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(120, 60)),
    track(new THREE.ShadowMaterial({ color: "#1b1f23", opacity: 0.2 }))
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  const blobTex = track(makeBlobTexture());
  const blobMat = () => {
    const m = track(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
    return m;
  };
  const blob = (w, d, x, z, m) => {
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d)), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    return mesh;
  };

  // ---- brick stack in the yard (cross-hatched courses like a real stacked pile) ----
  const stack = new THREE.Group();
  const stackBricks = [];
  const pile = (cx, cz, layers) => {
    for (let l = 0; l < layers; l += 1) {
      const y = BH / 2 + l * (BH + 0.004);
      if (l % 2 === 0) {
        for (let ix = 0; ix < 4; ix += 1) for (let iz = 0; iz < 8; iz += 1) stackBricks.push({ x: cx + (ix - 1.5) * (BL + 0.012), y, z: cz + (iz - 3.5) * (BW + 0.01), ry: 0 });
      } else {
        for (let ix = 0; ix < 8; ix += 1) for (let iz = 0; iz < 4; iz += 1) stackBricks.push({ x: cx + (ix - 3.5) * (BW + 0.01), y, z: cz + (iz - 1.5) * (BL + 0.012), ry: Math.PI / 2 });
      }
    }
  };
  pile(0.8, 0.15, 9); // the stack is built around x = 0 so a layout slot can place it anywhere
  pile(-1.9, -1.5, 6);
  // a few loose bricks on the ground
  [[2.65, 1.5, 0.5], [2.2, 1.85, -0.3], [1.8, 1.7, 0.2]].forEach(([x, z, r]) => stackBricks.push({ x, y: BH / 2, z, ry: r }));
  stack.add(placeBricks(stackBricks, stackMat));
  const stackBlobMat = blobMat();
  stack.add(blob(5.4, 4.2, 0.6, 0, stackBlobMat));
  const stackSlot = new THREE.Group(); // layout position / scale lives on the slot, GSAP animates the inner group
  stackSlot.add(stack);
  world.add(stackSlot);

  // ---- truck (faces -x, so it drives in from the right and the cab is on the left) ----
  const truck = new THREE.Group();
  const wheels = []; // spinning groups, rotated by GSAP according to the distance travelled

  // chassis
  truck.add(rbox(8.3, 0.2, 0.14, M.charcoalSoft, 0.03, 0, 0.88, 0.6));
  truck.add(rbox(8.3, 0.2, 0.14, M.charcoalSoft, 0.03, 0, 0.88, -0.6));
  [-3.4, -0.9, 1.6, 3.6].forEach((x) => truck.add(rbox(0.14, 0.16, 1.4, M.charcoalSoft, 0.03, x, 0.88, 0)));

  // wheels: steered axle at the front, tandem with twin tyres at the back
  const makeWheel = (z, side, detailed) => {
    const w = 0.34;
    const mount = new THREE.Group();
    mount.position.set(0, WHEEL_RADIUS, z);
    const spin = new THREE.Group();
    const tyre = cyl(WHEEL_RADIUS, WHEEL_RADIUS, w, M.rubber, 40);
    tyre.rotation.x = Math.PI / 2;
    const shoulder = new THREE.Mesh(track(new THREE.TorusGeometry(WHEEL_RADIUS * 0.84, 0.035, 8, 40)), M.rubber);
    shoulder.position.z = side * (w / 2);
    const rim = cyl(WHEEL_RADIUS * 0.56, WHEEL_RADIUS * 0.56, w + 0.03, M.steel, 36);
    rim.rotation.x = Math.PI / 2;
    spin.add(tyre, rim, shoulder);
    if (detailed) {
      const cap = cyl(0.17, 0.2, 0.1, M.orange, 24);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = side * (w / 2 + 0.05);
      spin.add(cap);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const nut = cyl(0.028, 0.028, 0.05, M.charcoalSoft, 8);
        nut.rotation.x = Math.PI / 2;
        nut.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, side * (w / 2 + 0.02));
        spin.add(nut);
      }
      const dish = cyl(WHEEL_RADIUS * 0.42, WHEEL_RADIUS * 0.5, 0.05, M.charcoalSoft, 32);
      dish.rotation.x = Math.PI / 2;
      dish.position.z = side * (w / 2 + 0.005);
      spin.add(dish);
    }
    bake(spin);
    mount.add(spin);
    wheels.push(spin);
    return mount;
  };
  const axle = (x, outerZ, twin) => {
    const g = new THREE.Group();
    g.position.x = x;
    g.add(makeWheel(outerZ, 1, true), makeWheel(-outerZ, -1, true));
    if (twin) g.add(makeWheel(outerZ - 0.4, 1, false), makeWheel(-(outerZ - 0.4), -1, false));
    const bar = cyl(0.07, 0.07, outerZ * 2, M.charcoalSoft, 12);
    bar.rotation.x = Math.PI / 2;
    bar.position.y = WHEEL_RADIUS;
    g.add(bar);
    truck.add(g);
  };
  axle(-2.95, 1.0, false);
  axle(1.75, 1.08, true);
  axle(3.1, 1.08, true);

  // mud flaps, fuel tank, vertical exhaust, cab steps
  [1.45, -1.45].forEach((z) => truck.add(rbox(0.04, 0.4, 0.5, M.rubber, 0.01, 3.95, 0.55, z * 0.82)));
  const tank = cyl(0.3, 0.3, 1.3, M.steel, 28);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.55, 0.82, 1.0);
  truck.add(tank);
  const exhaust = cyl(0.06, 0.06, 2.1, M.steel, 14);
  exhaust.position.set(-2.1, 2.0, 1.25);
  truck.add(exhaust);
  [1, -1].forEach((s) => truck.add(rbox(0.42, 0.05, 0.28, M.charcoalSoft, 0.015, -3.15, 0.72, s * 1.27)));

  // cab
  const CX = -3.2;
  truck.add(rbox(1.95, 1.95, 2.3, M.white, 0.14, CX, 1.95, 0));
  truck.add(rbox(1.97, 0.46, 2.32, M.charcoal, 0.08, CX, 1.2, 0));
  truck.add(rbox(1.99, 0.07, 2.34, M.orange, 0.02, CX, 1.47, 0));
  truck.add(rbox(2.06, 0.1, 2.4, M.white, 0.05, CX, 2.95, 0));
  truck.add(rbox(0.32, 0.06, 2.3, M.charcoal, 0.02, -4.2, 2.86, 0));
  const windshield = rbox(0.03, 0.92, 2.1, M.glass, 0.01, -4.19, 2.38, 0);
  windshield.rotation.z = -0.07;
  truck.add(windshield);
  truck.add(rbox(0.045, 0.94, 0.05, M.charcoal, 0.01, -4.2, 2.38, 0)); // centre pillar (split windscreen)
  truck.add(rbox(0.1, 0.07, 2.3, M.charcoal, 0.03, -4.24, 2.9, 0)); // sun visor
  [0.45, -0.45].forEach((z) => {
    const wiper = rbox(0.015, 0.03, 0.62, M.charcoal, 0.005, -4.215, 2.0, z);
    wiper.rotation.x = 0.35;
    truck.add(wiper);
  });
  [1, -1].forEach((s) => {
    truck.add(rbox(1.0, 0.76, 0.03, M.glass, 0.02, -3.35, 2.4, s * 1.16));
    truck.add(rbox(0.55, 0.6, 0.03, M.glass, 0.02, -2.5, 2.42, s * 1.16));
    truck.add(rbox(0.02, 1.5, 0.03, M.charcoal, 0.005, -2.82, 1.85, s * 1.165));
    truck.add(rbox(0.02, 1.5, 0.03, M.charcoal, 0.005, -3.88, 1.85, s * 1.165));
    truck.add(rbox(0.22, 0.045, 0.05, M.steel, 0.015, -2.98, 1.9, s * 1.18));
    truck.add(rbox(0.05, 0.05, 0.4, M.charcoal, 0.01, -3.98, 2.66, s * 1.35));
    truck.add(rbox(0.07, 0.62, 0.26, M.charcoal, 0.03, -4.0, 2.4, s * 1.58));
    truck.add(rbox(0.02, 0.5, 0.2, M.glass, 0.01, -4.04, 2.4, s * 1.58));
    truck.add(rbox(0.05, 0.05, 0.3, M.charcoal, 0.01, -3.98, 1.9, s * 1.4)); // lower convex mirror arm
    truck.add(rbox(0.12, 0.16, 0.16, M.charcoal, 0.04, -4.0, 1.88, s * 1.55));
    // grab handle and door step
    truck.add(rbox(0.04, 0.9, 0.04, M.steel, 0.01, -2.88, 1.7, s * 1.21));
    truck.add(rbox(0.5, 0.04, 0.2, M.steel, 0.01, -3.35, 0.95, s * 1.28));
  });
  // front: grille, headlights, bumper, number plate
  truck.add(rbox(0.05, 0.58, 1.5, M.charcoalSoft, 0.02, -4.2, 1.2, 0));
  for (let i = 0; i < 6; i += 1) truck.add(rbox(0.025, 0.03, 1.36, M.steel, 0.01, -4.235, 0.98 + i * 0.09, 0));
  [1, -1].forEach((s) => {
    truck.add(rbox(0.1, 0.34, 0.5, M.charcoalSoft, 0.04, -4.22, 1.2, s * 0.98)); // rectangular lamp housing
    truck.add(rbox(0.05, 0.26, 0.42, M.lamp, 0.03, -4.27, 1.2, s * 0.98)); // lens
    truck.add(rbox(0.04, 0.07, 0.16, M.orange, 0.02, -4.27, 1.02, s * 1.2)); // indicator
    truck.add(rbox(0.06, 0.08, 0.18, M.steel, 0.02, -4.5, 0.62, s * 0.55)); // tow hook
    truck.add(rbox(0.02, 0.06, 0.6, M.orange, 0.015, -4.44, 0.78, s * 0.85));
  });
  truck.add(rbox(0.4, 0.34, 2.5, M.charcoal, 0.09, -4.3, 0.76, 0));
  truck.add(rbox(0.02, 0.2, 0.5, M.white, 0.01, -4.455, 0.78, 0));

  // tipper body
  const BX = 1.1;
  truck.add(rbox(6.2, 0.16, 2.5, M.charcoal, 0.03, BX, 1.0, 0));
  [1, -1].forEach((s) => {
    truck.add(rbox(6.2, 0.85, 0.08, M.charcoal, 0.03, BX, 1.5, s * 1.21));
    truck.add(rbox(6.26, 0.08, 0.15, M.orange, 0.02, BX, 1.95, s * 1.21));
    for (let i = 0; i < 9; i += 1) truck.add(rbox(0.07, 0.9, 0.1, M.charcoalSoft, 0.02, -1.75 + i * 0.74, 1.5, s * 1.26));
  });
  truck.add(rbox(0.08, 0.85, 2.5, M.charcoal, 0.03, 4.11, 1.5, 0));
  truck.add(rbox(0.12, 0.08, 2.58, M.orange, 0.02, 4.11, 1.95, 0));
  truck.add(rbox(0.1, 1.55, 2.5, M.charcoal, 0.04, -1.9, 1.82, 0));
  truck.add(rbox(0.14, 0.08, 2.58, M.orange, 0.02, -1.9, 2.62, 0));

  // tipper hydraulic ram (steel) and rear hinge
  const tipRam = cyl(0.09, 0.09, 1.1, M.steel, 14);
  tipRam.position.set(-1.4, 1.35, 0);
  tipRam.rotation.z = 0.08;
  truck.add(tipRam);
  const ramOuter = cyl(0.13, 0.13, 0.6, M.charcoalSoft, 14);
  ramOuter.position.set(-1.38, 0.95, 0);
  truck.add(ramOuter);
  truck.add(rbox(0.25, 0.14, 2.3, M.charcoalSoft, 0.04, 4.15, 1.0, 0));

  // brick load: courses offset by half a brick, ends stepped so it reads as a neatly stacked heap
  const load = [];
  const LAYERS = 8;
  for (let l = 0; l < LAYERS; l += 1) {
    const y = 1.08 + BH / 2 + l * (BH + 0.004);
    const shift = l % 2 ? (BL + 0.02) / 2 : 0;
    const cut = Math.max(0, l - 5);
    for (let ix = 0; ix < 11; ix += 1) {
      if (ix < cut || ix > 10 - cut) continue;
      for (let iz = 0; iz < 9; iz += 1) {
        load.push({ x: BX - 2.62 + shift + ix * (BL + 0.02), y, z: (iz - 4) * (BW + 0.01), ry: 0 });
      }
    }
  }
  truck.add(placeBricks(load, brickMat));

  const truckBlob = blobMat();
  truck.add(blob(9.6, 3.6, 0.1, 0, truckBlob));
  bake(truck);
  truck.position.x = TRUCK_START_X;
  const truckSlot = new THREE.Group();
  truckSlot.add(truck);
  world.add(truckSlot);

  // ---- JCB 3DX-style backhoe loader (faces -x like the truck), modelled from the reference photographs ----
  // Not a stack of cubes: every body panel, boom, dipper, loader arm and bucket is an extruded, bevelled SIDE PROFILE traced
  // from the side-view photo (1 unit = 55 photo pixels), buckets are open shells with side plates and teeth, tyres are lathed
  // with chevron lugs, hydraulic rams have a dark barrel and a polished rod. Arms are pivot groups so GSAP moves real joints.
  const U = 55;
  const PX = (px) => (px - 250) / U;
  const PY = (py) => (287 - py) / U;
  const jm = {
    yellow: paint("#E9A416", { roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    yellowDark: paint("#CB880F", { roughness: 0.55, clearcoat: 0.3 }),
    rim: paint("#E59A17", { roughness: 0.5, clearcoat: 0.3 }),
    black: std("#1D2124", { roughness: 0.62, metalness: 0.3 }),
    bucket: std("#23272B", { roughness: 0.58, metalness: 0.45, side: THREE.DoubleSide }),
    steel: std("#B9BEC3", { roughness: 0.3, metalness: 0.9 }),
    rod: std("#C9CED2", { roughness: 0.18, metalness: 1 }),
    rubber: std("#15171A", { roughness: 0.96, side: THREE.DoubleSide }),
    glass: track(new THREE.MeshPhysicalMaterial({ color: "#26343C", roughness: 0.06, metalness: 0.45, clearcoat: 1, envMapIntensity: 1.7 })),
    lamp: std("#fff6df", { emissive: "#ffe3a8", emissiveIntensity: 0.8, roughness: 0.2 }),
    amber: std("#F2A33A", { emissive: "#c46d10", emissiveIntensity: 0.35, roughness: 0.3 }),
  };
  const jcbMats = Object.values(jm);
  const JS = 0.85; // model scale in the scene
  const jcb = new THREE.Group(); // animated by GSAP (entrance)
  const jcbModel = new THREE.Group();
  jcbModel.scale.setScalar(JS);
  jcb.add(jcbModel);
  const jBody = new THREE.Group();
  jcbModel.add(jBody);
  const jcbWheels = []; // { spin, r } r in scene units

  const jMesh = (m, g, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(track(g), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  // polygon given in photo pixels -> bevelled extrusion across z (centred on zc), geometry expressed relative to `org`
  const prof = (pts, depth, m, org = [250, 287], zc = 0, bevel = 0.025) => {
    const sh = new THREE.Shape();
    pts.forEach(([px, py], i) => {
      const x = PX(px) - PX(org[0]);
      const y = PY(py) - PY(org[1]);
      if (i === 0) sh.moveTo(x, y);
      else sh.lineTo(x, y);
    });
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.01, depth - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -(depth - bevel * 2) / 2 + zc);
    return jMesh(m, g);
  };
  // a thick polyline (arm, boom, bucket shell): offset both sides of the path by half its width
  const thick = (pts, widths) => {
    const n = pts.length;
    const L = [];
    const R = [];
    pts.forEach(([x, y], i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      const w = (Array.isArray(widths) ? widths[i] : widths) / 2;
      L.push([x - (ty / len) * w, y + (tx / len) * w]);
      R.push([x + (ty / len) * w, y - (tx / len) * w]);
    });
    return [...L, ...R.reverse()];
  };
  const roundRect = (x0, y0, x1, y1, r) => {
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 4; i += 1) {
        const a = a0 + (i / 4) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    corner(x1 - r, y0 + r, -Math.PI / 2);
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    return pts;
  };
  // hydraulic ram between two photo points (relative to org): dark barrel + polished rod, at depth z
  const ram = (p1, p2, z, org, rad = 0.07) => {
    const g = new THREE.Group();
    const x1 = PX(p1[0]) - PX(org[0]);
    const y1 = PY(p1[1]) - PY(org[1]);
    const x2 = PX(p2[0]) - PX(org[0]);
    const y2 = PY(p2[1]) - PY(org[1]);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;
    const barrelLen = len * 0.58;
    const barrel = cyl(rad * 1.35, rad * 1.35, barrelLen, jm.black, 14);
    const rodM = cyl(rad * 0.62, rad * 0.62, len * 0.52, jm.rod, 10);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    barrel.position.set(x1 + ux * barrelLen * 0.5, y1 + uy * barrelLen * 0.5, z);
    rodM.position.set(x2 - ux * len * 0.26, y2 - uy * len * 0.26, z);
    [barrel, rodM].forEach((m) => {
      m.rotation.z = ang;
      g.add(m);
    });
    [barrel, rodM].forEach((m) => g.remove(m));
    return [barrel, rodM];
  };
  const place = (group, org, parentOrg) => group.position.set(PX(org[0]) - PX(parentOrg[0]), PY(org[1]) - PY(parentOrg[1]), 0);
  const G0 = [250, 287]; // model origin: ground below the photo centre

  // ---------- tyres ----------
  const lugGeo = (r, w, count, rows) => {
    const list = [];
    const box = new THREE.BoxGeometry(0.13, 0.19, w * 0.46);
    for (let row = -1; row <= 1; row += 2) {
      if (rows === 1 && row === 1) continue;
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2 + (row > 0 ? Math.PI / count : 0);
        const m = new THREE.Matrix4()
          .makeRotationZ(a)
          .multiply(new THREE.Matrix4().makeTranslation(r + 0.015, 0, row * w * 0.25))
          .multiply(new THREE.Matrix4().makeRotationX(row * 0.5));
        const g = box.clone();
        g.applyMatrix4(m);
        list.push(g);
      }
    }
    box.dispose();
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    return merged;
  };
  const jWheel = (cx, cy, r, w, z, side, lugs) => {
    const mount = new THREE.Group();
    mount.position.set(PX(cx), PY(cy), z);
    const spin = new THREE.Group();
    // lathed tyre with rounded shoulders (profile in radius / width), axis turned to z
    const prof2 = [
      [r * 0.5, -w / 2], [r * 0.9, -w / 2], [r * 0.985, -w * 0.4], [r, -w * 0.18], [r, w * 0.18], [r * 0.985, w * 0.4], [r * 0.9, w / 2], [r * 0.5, w / 2],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const tyre = jMesh(jm.rubber, new THREE.LatheGeometry(prof2, 44));
    tyre.rotation.x = Math.PI / 2;
    spin.add(tyre);
    spin.add(jMesh(jm.rubber, lugGeo(r - 0.01, w, lugs, 2)));
    const face = cyl(r * 0.56, r * 0.56, w * 0.7, jm.rim, 40);
    face.rotation.x = Math.PI / 2;
    spin.add(face);
    const lip = jMesh(jm.black, new THREE.TorusGeometry(r * 0.56, 0.025, 8, 40), 0, 0, side * (w * 0.35));
    spin.add(lip);
    const cap = cyl(r * 0.2, r * 0.22, w * 0.8, jm.black, 24);
    cap.rotation.x = Math.PI / 2;
    spin.add(cap);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const bolt = cyl(0.025, 0.025, 0.06, jm.steel, 8);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, side * (w * 0.37));
      spin.add(bolt);
    }
    bake(spin);
    mount.add(spin);
    jcbWheels.push({ spin, r: r * JS });
    return mount;
  };
  const RW = 43.5 / U;
  const FW = 32 / U;
  [1, -1].forEach((s) => {
    jBody.add(jWheel(303, 243.5, RW, 0.78, s * 1.02, s, 22));
    jBody.add(jWheel(160, 255, FW, 0.52, s * 0.98, s, 18));
  });
  const axleR = cyl(0.12, 0.12, 2.0, jm.black, 12);
  axleR.rotation.x = Math.PI / 2;
  axleR.position.set(PX(303), PY(243.5), 0);
  const axleF = cyl(0.1, 0.1, 1.9, jm.black, 12);
  axleF.rotation.x = Math.PI / 2;
  axleF.position.set(PX(160), PY(255), 0);
  jBody.add(axleR, axleF);

  // ---------- main body (side profiles from the photograph) ----------
  jBody.add(prof([[172, 252], [172, 226], [352, 226], [352, 252]], 1.25, jm.black, G0)); // chassis / transmission, dark
  jBody.add(prof([[170, 230], [166, 200], [178, 176], [204, 164], [239, 152], [242, 230]], 1.5, jm.yellow, G0, 0, 0.05)); // engine hood
  jBody.add(prof([[236, 232], [236, 168], [352, 168], [352, 232]], 1.86, jm.yellow, G0, 0, 0.05)); // cab floor / skirt
  jBody.add(prof([[351, 240], [351, 150], [366, 128], [388, 134], [394, 240]], 1.6, jm.yellow, G0, 0, 0.05)); // rear swing tower
  jBody.add(prof([[166, 218], [166, 198], [172, 196], [172, 220]], 1.16, jm.black, G0)); // front grille panel
  for (let i = 0; i < 4; i += 1) jBody.add(prof([[164, 200 + i * 5], [166, 200 + i * 5], [166, 202 + i * 5], [164, 202 + i * 5]], 1.0, jm.steel, G0, 0, 0.005));
  // fenders over the big rear tyres (yellow arcs) and mudguards on the front
  [1, -1].forEach((s) => {
    const arc = [];
    const ro = RW + 0.17;
    const ri = RW + 0.07;
    for (let i = 0; i <= 14; i += 1) {
      const a = Math.PI * (0.02 + 0.96 * (i / 14));
      arc.push([303 + Math.cos(a) * ro * U, 243.5 - Math.sin(a) * ro * U]);
    }
    for (let i = 14; i >= 0; i -= 1) {
      const a = Math.PI * (0.02 + 0.96 * (i / 14));
      arc.push([303 + Math.cos(a) * ri * U, 243.5 - Math.sin(a) * ri * U]);
    }
    jBody.add(prof(arc, 0.82, jm.yellow, G0, s * 1.02, 0.02));
    jBody.add(prof([[134, 232], [160, 224], [186, 232], [186, 236], [134, 236]], 0.6, jm.black, G0, s * 0.98, 0.012));
  });

  // ---------- operator cab ----------
  jBody.add(prof([[232, 184], [243, 110], [347, 110], [347, 184]], 1.62, jm.glass, G0, 0, 0.012)); // glazing volume
  jBody.add(prof(roundRect(230, 98, 354, 113, 5), 1.92, jm.yellow, G0, 0, 0.04)); // roof
  jBody.add(prof([[236, 112], [352, 112], [352, 119], [236, 119]], 1.78, jm.black, G0, 0, 0.01)); // roof liner
  [1, -1].forEach((s) => {
    jBody.add(prof(thick([[232, 184], [243, 112]], 6), 0.1, jm.black, G0, s * 0.82, 0.012)); // A pillar
    jBody.add(prof(thick([[347, 184], [347, 112]], 7), 0.1, jm.black, G0, s * 0.82, 0.012)); // rear pillar
    jBody.add(prof(thick([[292, 184], [292, 112]], 6), 0.08, jm.black, G0, s * 0.82, 0.01)); // door frame
    jBody.add(prof(thick([[232, 184], [352, 184]], 7), 0.1, jm.black, G0, s * 0.82, 0.01)); // sill
    jBody.add(prof(thick([[243, 112], [347, 112]], 5), 0.1, jm.black, G0, s * 0.82, 0.01)); // header
    jBody.add(prof([[268, 148], [276, 148], [276, 152], [268, 152]], 0.12, jm.steel, G0, s * 0.9, 0.01)); // door handle
    // mirror, arm and head
    jBody.add(prof(thick([[233, 146], [222, 140]], 3), 0.06, jm.black, G0, s * 1.0, 0.008));
    jBody.add(prof(roundRect(214, 124, 226, 154, 2), 0.1, jm.black, G0, s * 1.1, 0.012));
    // roof work lamps
    jBody.add(prof(roundRect(236, 92, 252, 100, 2), 0.2, jm.black, G0, s * 0.62, 0.01));
    jBody.add(prof(roundRect(334, 92, 350, 100, 2), 0.2, jm.black, G0, s * 0.62, 0.01));
    // front lamps on the hood corners
    jBody.add(prof(roundRect(176, 190, 188, 202, 2), 0.22, jm.lamp, G0, s * 0.52, 0.008));
    // steps and handrail
    jBody.add(prof([[240, 226], [292, 226], [292, 232], [240, 232]], 0.34, jm.black, G0, s * 1.0, 0.01));
    jBody.add(prof(thick([[236, 188], [236, 150]], 3), 0.05, jm.steel, G0, s * 0.96, 0.006));
  });
  jBody.add(prof([[258, 150], [292, 150], [292, 196], [258, 196]], 0.5, jm.black, G0, 0, 0.04)); // seat
  jBody.add(prof([[286, 126], [300, 126], [300, 160], [286, 160]], 0.5, jm.black, G0, 0, 0.04)); // seat back
  jBody.add(jMesh(jm.amber, new THREE.SphereGeometry(0.1, 14, 10), PX(334), PY(88), 0.5)); // beacon
  // exhaust stack
  jBody.add(jMesh(jm.black, new THREE.CylinderGeometry(0.055, 0.055, 1.25, 12), PX(213), PY(132), 0.78));
  jBody.add(jMesh(jm.steel, new THREE.CylinderGeometry(0.075, 0.055, 0.08, 12), PX(213), PY(98), 0.78));

  // ---------- stabiliser legs ----------
  [1, -1].forEach((s) => {
    jBody.add(prof([[355, 196], [355, 262], [368, 262], [368, 196]], 0.24, jm.yellow, G0, s * 1.2, 0.02));
    jBody.add(prof([[348, 264], [376, 264], [378, 272], [346, 272]], 0.5, jm.black, G0, s * 1.2, 0.015));
    jBody.add(prof([[352, 168], [372, 168], [372, 200], [352, 200]], 0.5, jm.yellowDark, G0, s * 1.2, 0.02));
    ram([356, 196], [364, 252], s * 1.02, G0, 0.05).forEach((m) => jBody.add(m));
  });
  bake(jBody);

  // ---------- front loader: arms -> bucket ----------
  const LA = [232, 172]; // loader arm pivot (photo px)
  const loaderArm = new THREE.Group();
  place(loaderArm, LA, G0);
  jBody.add(loaderArm);
  const armPath = [[232, 172], [190, 196], [140, 222], [100, 243], [76, 251]];
  [1, -1].forEach((s) => {
    loaderArm.add(prof(thick(armPath, [20, 18, 16, 14, 14]), 0.2, jm.yellow, LA, s * 0.98, 0.025));
    ram([226, 214], [160, 204], s * 0.76, LA, 0.07).forEach((m) => loaderArm.add(m)); // lift ram
    ram([230, 150], [205, 190], s * 0.7, LA, 0.05).forEach((m) => loaderArm.add(m));
  });
  loaderArm.add(jMesh(jm.yellowDark, new THREE.CylinderGeometry(0.1, 0.1, 1.96, 14), PX(150) - PX(LA[0]), PY(218) - PY(LA[1]), 0).rotateX(Math.PI / 2));
  bake(loaderArm);

  const LB = [76, 251]; // bucket pivot
  const loaderBucket = new THREE.Group();
  place(loaderBucket, LB, LA);
  loaderArm.add(loaderBucket);
  loaderBucket.add(prof(thick([[20, 236], [20, 272], [32, 286], [82, 287], [86, 240]], 7), 2.3, jm.bucket, LB, 0, 0.02)); // shell: lip, floor, back
  loaderBucket.add(prof([[16, 234], [34, 230], [88, 234], [90, 262], [84, 287], [30, 289], [16, 282]], 0.1, jm.bucket, LB, 1.15, 0.015)); // side plates
  loaderBucket.add(prof([[16, 234], [34, 230], [88, 234], [90, 262], [84, 287], [30, 289], [16, 282]], 0.1, jm.bucket, LB, -1.15, 0.015));
  loaderBucket.add(prof([[14, 280], [34, 286], [34, 290], [14, 286]], 2.3, jm.steel, LB, 0, 0.008)); // cutting edge
  for (let i = 0; i < 8; i += 1) loaderBucket.add(prof([[6, 285], [18, 281], [18, 288]], 0.14, jm.steel, LB, -1.0 + i * 0.29, 0.006)); // teeth
  loaderBucket.add(prof([[80, 238], [100, 232], [102, 244], [84, 250]], 0.3, jm.black, LB, 0, 0.02)); // bucket lug
  [1, -1].forEach((s) => ram([128, 226], [92, 240], s * 0.62, LB, 0.05).forEach((m) => loaderBucket.add(m))); // tilt ram
  bake(loaderBucket);

  // ---------- rear excavator: boom -> dipper -> bucket ----------
  const BO = [388, 214];
  const boom = new THREE.Group();
  place(boom, BO, G0);
  jBody.add(boom);
  boom.add(prof(thick([[388, 214], [394, 160], [410, 104], [426, 68], [442, 62]], [34, 32, 30, 26, 22]), 0.44, jm.yellow, BO, 0, 0.03));
  boom.add(prof(thick([[380, 190], [386, 130]], 8), 0.1, jm.yellowDark, BO, 0.3, 0.01));
  [1, -1].forEach((s) => {
    ram([368, 182], [408, 108], s * 0.34, BO, 0.06).forEach((m) => boom.add(m)); // boom ram
    ram([420, 58], [450, 104], s * 0.3, BO, 0.05).forEach((m) => boom.add(m)); // dipper ram
  });
  bake(boom);

  const DP = [440, 66];
  const stick = new THREE.Group();
  place(stick, DP, BO);
  boom.add(stick);
  stick.add(prof(thick([[440, 66], [450, 118], [460, 168], [468, 204]], [26, 22, 19, 16]), 0.34, jm.yellow, DP, 0, 0.025));
  stick.add(prof([[462, 196], [480, 190], [484, 206], [468, 214]], 0.4, jm.yellowDark, DP, 0, 0.02)); // bucket hitch
  [1, -1].forEach((s) => ram([452, 92], [482, 176], s * 0.26, DP, 0.045).forEach((m) => stick.add(m))); // bucket ram
  bake(stick);

  const HB = [468, 206];
  const hoeBucket = new THREE.Group();
  place(hoeBucket, HB, DP);
  stick.add(hoeBucket);
  hoeBucket.add(prof(thick([[436, 170], [432, 206], [446, 226], [480, 230], [492, 204]], 6), 0.82, jm.bucket, HB, 0, 0.02));
  [1, -1].forEach((s) => hoeBucket.add(prof([[432, 172], [458, 166], [488, 178], [494, 206], [482, 230], [446, 228], [432, 206]], 0.07, jm.bucket, HB, s * 0.41, 0.012)));
  for (let i = 0; i < 4; i += 1) hoeBucket.add(prof([[438, 230], [452, 226], [452, 236]], 0.12, jm.steel, HB, -0.3 + i * 0.2, 0.006));
  bake(hoeBucket);

  const jcbBlob = blob(7.6, 3.6, 0.0, 0, blobMat());
  jcb.add(jcbBlob);
  const jcbBlobMat = jcbBlob.material;
  const jcbSlot = new THREE.Group();
  jcbSlot.add(jcb);
  world.add(jcbSlot);

  const jcbParts = { loaderArm, loaderBucket, boom, stick, hoeBucket };

  const setJcbOpacity = (o) => {
    jcbMats.forEach((m) => {
      m.transparent = o < 1;
      m.opacity = o;
    });
    jcbBlobMat.opacity = 0.55 * o;
  };
  setJcbOpacity(1);
  jcb.position.x = JCB_START_X;

  // ---- responsive scene layouts + camera framing ----
  // desktop (>= 1024 px): one row  [bricks] [JCB] [truck], perspective camera from the front-left.
  // tablet  (640-1023 px): two rows, truck at the back, bricks + JCB in front, orthographic camera.
  // mobile  (< 640 px): three rows stacked vertically: truck, JCB, bricks, orthographic camera, each model kept large.
  const target = new THREE.Vector3();
  const rowPos = (slot, scale, viewX, viewY, objY, az, el) => {
    // inverse of the camera's view-plane mapping (see layout notes): solves world x/z for a wanted screen position
    const z = (objY * scale * Math.cos(el) - viewY) / Math.sin(el);
    const x = (viewX - z * Math.sin(az)) / Math.cos(az);
    slot.position.set(x, 0, z);
    slot.scale.setScalar(scale);
  };
  let mode = "desktop";
  const aim = (az, el, dist) => {
    camera.position.set(target.x - dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(target);
  };
  const layout = (w, h) => {
    mode = w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
    const aspect = w / h;
    if (mode === "desktop") {
      camera = persp;
      stackSlot.position.set(-10.8, 0, 0);
      jcbSlot.position.set(-3.0, 0, 0);
      truckSlot.position.set(7.7, 0, 0);
      [stackSlot, jcbSlot, truckSlot].forEach((s) => s.scale.setScalar(1));
      target.set(-1.3, 1.4, 0);
      persp.aspect = aspect;
      const tv = Math.tan((persp.fov * Math.PI) / 360);
      const dist = Math.max(31 / (2 * tv * aspect), 8 / (2 * tv));
      aim(0.36, 0.15, dist);
      persp.updateProjectionMatrix();
      return;
    }
    camera = ortho;
    const az = mode === "mobile" ? 0.3 : 0.3;
    const el = mode === "mobile" ? 0.52 : 0.4;
    // frame width in world units; grow it when the host is short so every row still fits
    const minH = mode === "mobile" ? 15 : 9.6;
    const W = Math.max(mode === "mobile" ? 11.8 : 19.5, minH * aspect);
    const H = W / aspect;
    target.set(0, 0, 0);
    if (mode === "mobile") {
      const step = Math.min(H * 0.31, 5.6);
      rowPos(truckSlot, 1, 0.12, step, 1.55, az, el);
      rowPos(jcbSlot, 1.02, 0, 0, 1.8, az, el);
      rowPos(stackSlot, 1.45, 0, -step, 0.85, az, el);
    } else {
      const up = H * 0.2;
      rowPos(truckSlot, 1, 0.12, up, 1.55, az, el);
      rowPos(stackSlot, 1.15, -4.7, -H * 0.2, 0.85, az, el);
      rowPos(jcbSlot, 1.02, 4.15, -H * 0.2, 1.8, az, el);
    }
    ortho.left = -W / 2;
    ortho.right = W / 2;
    ortho.top = H / 2;
    ortho.bottom = -H / 2;
    aim(az, el, 60);
    ortho.updateProjectionMatrix();
  };

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 || lowPower ? 1.5 : 1.75));
    renderer.setSize(w, h, false);
    layout(w, h);
    changed = true;
  };
  let changed = true;
  resize();

  // ---- render on demand: draw (and refresh shadows) only on frames where something actually moved ----
  const watch = () => [
    truck.position.x, truck.position.y, truck.rotation.z,
    jcb.position.x, jcb.position.y,
    stack.position.y, stackMat.opacity, jcbBlobMat.opacity,
    world.position.x, world.position.y, world.rotation.y, world.scale.x,
    loaderArm.rotation.z, loaderBucket.rotation.z, boom.rotation.z, stick.rotation.z, hoeBucket.rotation.z,
    wheels[0].rotation.z, jcbWheels[0].spin.rotation.z,
  ];
  let last = [];
  const render = () => {
    const now = watch();
    let moved = changed || now.length !== last.length;
    for (let i = 0; !moved && i < now.length; i += 1) if (now[i] !== last[i]) moved = true;
    if (!moved) return false;
    last = now;
    changed = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    return true;
  };

  const setStackOpacity = (o) => {
    stackMat.transparent = o < 1;
    stackMat.opacity = o;
    stackBlobMat.opacity = 0.55 * o;
  };
  setStackOpacity(0);
  truckBlob.opacity = 0.55;

  // Warm-up: three.js only compiles shaders and uploads textures for objects inside the view. Both vehicles start off-screen,
  // so without this their first appearance compiles shaders mid-animation (a visible hitch). Render once with everything in
  // view, then put the scene back to its starting pose.
  const warmUp = () => {
    const keep = { t: truck.position.x, j: jcb.position.x };
    truck.position.x = 0;
    jcb.position.x = 0;
    setStackOpacity(1);
    renderer.compile(scene, camera);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    truck.position.x = keep.t;
    jcb.position.x = keep.j;
    setStackOpacity(0);
    last = [];
    changed = true;
  };

  const dispose = () => {
    disposables.forEach((d) => d.dispose?.());
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  warmUp();
  const stats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, mode });
  return { render, resize, dispose, world, truck, stack, wheels, jcb, jcbParts, jcbWheels, setStackOpacity, setJcbOpacity, stats };
}
