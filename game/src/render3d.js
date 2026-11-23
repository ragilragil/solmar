// SOLMAR in real 3D: a Three.js scene built from the same world data the
// 2D game used. Every actor the logic owns — buildings, roads, beach, cars,
// pedestrians, pickups, the GPS line, bullets, particles, skid marks — gets a
// low-poly mesh here, and a third-person chase camera follows the player.
// The game logic never sees this file's internals: it only hands over G.
import {
  TILE, WORLD_W, WORLD_H, V_ROADS, H_ROADS, ROAD_W,
  SAND_TOP, SEA_TOP, PALETTE, DAY_LENGTH,
} from './config.js';
import { hitsBuilding, nearestRoadPoint } from './world.js';
import { HELIPAD, AIRSTRIP } from './aircraft.js';

// A small deterministic hash of a building's position: the same city always
// gets the same heights, without touching the game's own random stream.
function hash01(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function hexColor(css) {
  return new THREE.Color(css);
}

// Three window-grid texture variants, drawn once on offscreen canvases.
// Each variant lights a different random-looking set of windows warm, so
// neighbouring buildings do not repeat the same lit pattern. A building
// clones its variant with its own repeat so the windows stay roughly square
// no matter how tall or wide the box is.
function makeWindowTexture(variant) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  // A light wall with dark glass: the material colour tints the wall, so the
  // buildings stay bright in the sun instead of going nearly black.
  g.fillStyle = '#9aa7b5';
  g.fillRect(0, 0, 128, 128);
  // Two extra variants: tall windows with more of them lit warm, and a
  // dense grid of small cool windows, so the skyline does not repeat.
  const layout = variant === 3
    ? { rows: 6, cols: 5, ww: 14, wh: 12, warm: 0.3 }
    : variant === 4
      ? { rows: 10, cols: 8, ww: 9, wh: 7, warm: 0.16 }
      : { rows: 8, cols: 6, ww: 12, wh: 9, warm: 0.22 };
  const stepX = 128 / layout.cols;
  const stepY = 112 / layout.rows;
  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      const h = hash01(row * 7 + variant * 13, col * 11 + variant * 5);
      if (h < layout.warm) g.fillStyle = '#ffd98a';
      else if (h < layout.warm + 0.08) g.fillStyle = '#f7e3b0';
      else if (h < layout.warm + 0.14) g.fillStyle = '#7fb2d9';
      else g.fillStyle = '#2c3e55';
      g.fillRect(4 + col * stepX + (stepX - layout.ww) / 2, 6 + row * stepY + (stepY - layout.wh) / 2, layout.ww, layout.wh);
    }
  }
  // A darker ground-floor band: shopfronts and entrances read at street level.
  g.fillStyle = '#5d6b7d';
  g.fillRect(0, 112, 128, 16);
  g.fillStyle = '#c8d4e0';
  g.fillRect(52, 112, 24, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Sky gradient for the dome: deep blue overhead, softening through pale
// blue to a warm hazy band at the horizon, so the sky reads as a real
// late-afternoon sky instead of a flat fill.
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1d5c9e');
  grad.addColorStop(0.35, '#4f97d9');
  grad.addColorStop(0.55, '#8fc4ec');
  grad.addColorStop(0.7, '#cfe8f5');
  grad.addColorStop(0.82, '#ffe9bd');
  grad.addColorStop(0.92, '#ffcf96');
  grad.addColorStop(1, '#f0b57e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// A soft radial glow: bright core fading to nothing, used for the sun disc
// and its halo so the sun has a real glare instead of a hard-edged circle.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// A cloud puff: several overlapping soft white blobs with a shaded grey-blue
// belly, so the billboard reads as a real cloud instead of a flat shape.
function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const puffs = [
    [70, 78, 52], [120, 62, 62], [180, 76, 56], [150, 88, 48],
    [95, 92, 42], [205, 92, 40], [45, 92, 36],
  ];
  for (const [x, y, r] of puffs) {
    const grad = g.createRadialGradient(x, y, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Shade the belly only where cloud already is, so no rectangle edge shows.
  g.globalCompositeOperation = 'source-atop';
  const belly = g.createLinearGradient(0, 70, 0, 128);
  belly.addColorStop(0, 'rgba(190,205,220,0)');
  belly.addColorStop(1, 'rgba(170,190,210,0.35)');
  g.fillStyle = belly;
  g.fillRect(0, 70, 256, 58);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// The sea as a small custom shader: rolling vertex waves, a colour gradient
// from pale shallow water at the beach to deep blue offshore, a sun-glitter
// path, foam rolling in at the shoreline and whitecaps further out. Fog,
// tone mapping and sRGB output are the same chunks the built-in materials
// use, so the water sits in the scene instead of glowing past it.
const SEA_VERT = `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec3 p = position;
  float t = uTime;
  float w1 = t * 1.15 + p.x * 0.045;
  float w2 = t * 0.85 - p.y * 0.06;
  float w3 = t * 0.5 + (p.x + p.y) * 0.028;
  float h = sin(w1) * 0.9 + sin(w2) * 0.7 + sin(w3) * 1.0;
  p.z += h;
  float dhdx = 0.045 * 0.9 * cos(w1) + 0.028 * 1.0 * cos(w3);
  float dhdy = -0.06 * 0.7 * cos(w2) + 0.028 * 1.0 * cos(w3);
  vec3 nLocal = normalize(vec3(-dhdx, -dhdy, 1.0));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * nLocal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
}
`;
const SEA_FRAG = `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uShoreZ;
uniform float uNight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float off = clamp((vWorldPos.z - uShoreZ) / 900.0, 0.0, 1.0);
  // Colours are authored in linear space: the sRGB output conversion at
  // the end brightens everything, so sRGB-looking values here would wash
  // the sea out to near white.
  vec3 shallow = vec3(0.18, 0.65, 0.55);
  vec3 mid = vec3(0.03, 0.36, 0.47);
  vec3 deep = vec3(0.01, 0.16, 0.27);
  vec3 col = mix(shallow, mid, smoothstep(0.0, 0.35, off));
  col = mix(col, deep, smoothstep(0.3, 0.9, off));
  col *= 0.88 + 0.22 * max(dot(N, vec3(0.0, 1.0, 0.0)), 0.0);
  // Night: the water goes dark with the rest of the city, and the sun
  // glitter dies with the sun.
  col *= 1.0 - 0.82 * uNight;
  float shoreDist = vWorldPos.z - uShoreZ;
  float foamBand = 1.0 - smoothstep(0.0, 90.0, shoreDist);
  float foamLines = 0.5 + 0.5 * sin(shoreDist * 0.22 - uTime * 1.5 + sin(vWorldPos.x * 0.045) * 2.5);
  float foam = foamBand * (0.3 + 0.6 * foamLines);
  float cap = smoothstep(0.85, 0.98, sin(vWorldPos.x * 0.16 + uTime * 0.7) * sin(vWorldPos.z * 0.19 - uTime * 0.55));
  cap *= smoothstep(150.0, 340.0, shoreDist) * 0.18;
  col = mix(col, vec3(0.98, 1.0, 1.0), clamp(foam * 0.6 + cap, 0.0, 1.0));
  vec3 R = reflect(-V, N);
  float g = max(dot(R, uSunDir), 0.0);
  float sparkle = 0.72 + 0.28 * sin(vWorldPos.x * 0.6 + uTime * 2.0) * sin(vWorldPos.z * 0.55 - uTime * 1.6);
  col += vec3(1.0, 0.93, 0.75) * pow(g, 260.0) * 1.5 * sparkle * (1.0 - uNight);
  col += vec3(1.0, 0.88, 0.66) * pow(g, 20.0) * 0.16 * (1.0 - uNight);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  // Manual fog: three's fog chunks crash this shader program (the renderer
  // refreshes fog uniforms the program never declared), so the sea blends
  // into the same fog the rest of the scene uses by hand.
  float fogDepth = length(cameraPosition - vWorldPos);
  float fogFactor = smoothstep(uFogNear, uFogFar, fogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
}
`;

// Road surface: dark asphalt with speckles, solid edge lines and a dashed
// centre line. Drawn in "along" coordinates (u runs down the road), so the
// horizontal variant is the same drawing rotated 90 degrees at creation.
// One tile is 192 world units long.
function makeRoadTexture(horizontal) {
  const c = document.createElement('canvas');
  c.width = horizontal ? 192 : 128;
  c.height = horizontal ? 128 : 192;
  const g = c.getContext('2d');
  if (horizontal) {
    g.translate(0, 128);
    g.rotate(-Math.PI / 2);
  }
  g.fillStyle = '#3a363e';
  g.fillRect(0, 0, 128, 192);
  for (let i = 0; i < 420; i += 1) {
    const h = hash01(i * 3.1, i * 7.7);
    g.fillStyle = h < 0.5 ? '#443f49' : '#322e36';
    g.fillRect(Math.floor(hash01(i, 1) * 128), Math.floor(hash01(i, 2) * 192), 2, 2);
  }
  g.fillStyle = '#d8d4c8';
  g.fillRect(5, 0, 4, 192);
  g.fillRect(119, 0, 4, 192);
  g.fillStyle = '#e8d44d';
  g.fillRect(60, 18, 8, 58);
  g.fillRect(60, 114, 8, 58);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Pale paving slabs for the sidewalks, so the kerbs read as pavement
// instead of one flat cream sheet.
function makeSidewalkTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#cbc3b2';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i += 1) {
    const h = hash01(i * 5.3, i * 2.9);
    g.fillStyle = h < 0.5 ? '#d6cfbf' : '#bfb6a2';
    g.fillRect(Math.floor(hash01(i, 4) * 128), Math.floor(hash01(i, 5) * 128), 2, 2);
  }
  g.strokeStyle = '#a89e88';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildingMaterial(colorCss, w, h, tex) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(1, Math.round(w / 90)), Math.max(1, Math.round(h / 90)));
  return new THREE.MeshStandardMaterial({ map: t, color: hexColor(colorCss), roughness: 0.85, metalness: 0.05 });
}

export function createRenderer3D(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // ?lowfx=1 is a test aid for software-rendered browsers (SwiftShader runs
  // this scene at ~2 fps): no shadow pass and half resolution, so the game
  // loop runs fast enough to drive with a keyboard. The shipped game never
  // passes it — screenshots and real play use the full renderer.
  const lowfx = new URLSearchParams(location.search).has('lowfx');
  renderer.shadowMap.enabled = !lowfx;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(lowfx ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
  // Filmic tone mapping + sRGB output: highlights roll off like a camera
  // instead of clipping to white, and colours stay true on screen.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe4ef, 700, 2400);

  // Sky dome: a gradient shell around the whole city with a low sun disc,
  // so the horizon is warm haze instead of a flat colour. It ignores fog
  // and never writes depth, so it always sits behind everything.
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  skyDome.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  skyDome.renderOrder = -1;
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  const sunDir = new THREE.Vector3(0.55, 0.62, 0.35).normalize();
  // The sun as a soft-edged disc with two glow shells, so it reads as a
  // glaring late-afternoon sun instead of a flat circle pasted on the sky.
  const sunGlowTex = makeGlowTexture();
  const sunDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshBasicMaterial({ map: sunGlowTex, color: 0xfff6cf, fog: false, transparent: true, opacity: 0.98, depthWrite: false }),
  );
  sunDisc.position.set(
    WORLD_W / 2 + sunDir.x * 3300,
    sunDir.y * 3300,
    WORLD_H / 2 + sunDir.z * 3300,
  );
  sunDisc.lookAt(WORLD_W / 2, 0, WORLD_H / 2);
  scene.add(sunDisc);
  const sunGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 760),
    new THREE.MeshBasicMaterial({ map: sunGlowTex, color: 0xffe9a8, fog: false, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  sunGlow.position.copy(sunDisc.position);
  sunGlow.lookAt(WORLD_W / 2, 0, WORLD_H / 2);
  scene.add(sunGlow);
  const sunHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshBasicMaterial({ map: sunGlowTex, color: 0xffe0a0, fog: false, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  sunHalo.position.copy(sunDisc.position);
  sunHalo.lookAt(WORLD_W / 2, 0, WORLD_H / 2);
  scene.add(sunHalo);
  // The moon, opposite the sun: it only shows once the night falls, so the
  // sky has something to look at after dark instead of an empty dome.
  const moonDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshBasicMaterial({ map: sunGlowTex, color: 0xdfe8f8, fog: false, transparent: true, opacity: 0, depthWrite: false }),
  );
  moonDisc.position.set(
    WORLD_W / 2 - sunDir.x * 3300,
    2600,
    WORLD_H / 2 - sunDir.z * 3300,
  );
  moonDisc.lookAt(WORLD_W / 2, 0, WORLD_H / 2);
  moonDisc.visible = false;
  scene.add(moonDisc);
  const moonGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshBasicMaterial({ map: sunGlowTex, color: 0xaec4e8, fog: false, transparent: true, opacity: 0, depthWrite: false }),
  );
  moonGlow.position.copy(moonDisc.position);
  moonGlow.lookAt(WORLD_W / 2, 0, WORLD_H / 2);
  moonGlow.visible = false;
  scene.add(moonGlow);

  const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 1, 5000);

  // Warm afternoon sun, plus a soft sky fill so the shadowed sides are never
  // pitch black.
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -480;
  sun.shadow.camera.right = 480;
  sun.shadow.camera.top = 480;
  sun.shadow.camera.bottom = -480;
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xd0e6ff, 0x9a8a68, 1.2);
  scene.add(hemi);

  const winTexes = [makeWindowTexture(0), makeWindowTexture(1), makeWindowTexture(2), makeWindowTexture(3), makeWindowTexture(4)];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  function flatPlane(w, h, colorCss, x, y, z, receiveShadow) {
    const m = new THREE.Mesh(
      planeGeo,
      new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.95, metalness: 0 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    if (receiveShadow) m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // Grass base, big enough that the camera never sees the void past an edge.
  flatPlane(WORLD_W + 900, WORLD_H + 900, PALETTE.grass, WORLD_W / 2, 0, WORLD_H / 2, true);

  // Sidewalk blocks (the same block edges the 2D view drew), now with a
  // paving-slab texture so the kerbs read as pavement.
  const sidewalkTexBase = makeSidewalkTexture();
  const bxEdges = [0, 7, 14, 21, 28, 35, 42, 44];
  const byEdges = [0, 7, 14, 21, 28, 30];
  for (let i = 0; i < bxEdges.length - 1; i += 1) {
    for (let j = 0; j < byEdges.length - 1; j += 1) {
      const x0 = bxEdges[i] * TILE;
      const y0 = byEdges[j] * TILE;
      const w = (bxEdges[i + 1] - bxEdges[i]) * TILE;
      const h = (byEdges[j + 1] - byEdges[j]) * TILE;
      const swTex = sidewalkTexBase.clone();
      swTex.needsUpdate = true;
      swTex.repeat.set(Math.max(1, Math.round(w / 96)), Math.max(1, Math.round(h / 96)));
      const sw = new THREE.Mesh(
        planeGeo,
        new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.95, metalness: 0 }),
      );
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(x0 + w / 2, 0.15, y0 + h / 2);
      sw.receiveShadow = true;
      scene.add(sw);
    }
  }

  // Park lawn and pond, docks yard and pier.
  flatPlane(world.park.w, world.park.h, PALETTE.park, world.park.x + world.park.w / 2, 0.2, world.park.y + world.park.h / 2, true);
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(34, 24),
    new THREE.MeshLambertMaterial({ color: hexColor('#7ec8e8') }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(1, 22 / 34, 1);
  pond.position.set(world.park.x + world.park.w / 2, 0.3, world.park.y + world.park.h / 2);
  scene.add(pond);
  flatPlane(world.docks.w, world.docks.h, '#9a938a', world.docks.x + world.docks.w / 2, 0.2, world.docks.y + world.docks.h / 2, true);
  flatPlane(14, world.docks.h, PALETTE.pier, world.docks.x + world.docks.w - 7, 0.25, world.docks.y + world.docks.h / 2, true);

  // Beach sand, then the sea stretching south past the world edge: a
  // segmented plane running the custom water shader (rolling waves, a
  // sun-glitter path, foam at the shoreline, whitecaps further out).
  flatPlane(WORLD_W, SEA_TOP - SAND_TOP, PALETTE.sand, WORLD_W / 2, 0.1, (SAND_TOP + SEA_TOP) / 2, true);
  const seaUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir },
    uShoreZ: { value: SEA_TOP },
    uNight: { value: 0 },
    uFogColor: { value: new THREE.Color(0xcfe4ef) },
    uFogNear: { value: 700 },
    uFogFar: { value: 2400 },
  };
  const seaGeo = new THREE.PlaneGeometry(WORLD_W + 900, 900, 96, 20);
  const sea = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
    uniforms: seaUniforms,
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    fog: false,
  }));
  sea.rotation.x = -Math.PI / 2;
  // The base sits 3 units up: the wave troughs dip ~2.6 below it, so the
  // water never sinks under the grass/sand plane and the ground never shows
  // through the troughs as pale bands.
  sea.position.set(WORLD_W / 2, 3.0, SEA_TOP + 450);
  scene.add(sea);

  // Roads: a canvas asphalt texture with speckles, edge lines and a dashed
  // centre line, tiled along each street so the markings stay the same
  // size everywhere. Crosswalks stay as instanced stripes below.
  const roadTexV = makeRoadTexture(false);
  const roadTexH = makeRoadTexture(true);
  function roadPlane(w, h, x, z, horizontal) {
    const t = (horizontal ? roadTexH : roadTexV).clone();
    t.needsUpdate = true;
    if (horizontal) t.repeat.set(Math.max(1, Math.round(w / 192)), 1);
    else t.repeat.set(1, Math.max(1, Math.round(h / 192)));
    const m = new THREE.Mesh(
      planeGeo,
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, h, 1);
    m.position.set(x, 0.3, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  for (const vx of V_ROADS) {
    roadPlane(ROAD_W, SAND_TOP, vx * TILE + ROAD_W / 2, SAND_TOP / 2, false);
  }
  for (const hy of H_ROADS) {
    roadPlane(WORLD_W, ROAD_W, WORLD_W / 2, hy * TILE + ROAD_W / 2, true);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const stripeGeo = new THREE.BoxGeometry(7, 1, 16);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const stripeSpots = [];
  for (const n of world.intersections) {
    for (let i = -2; i <= 2; i += 1) {
      stripeSpots.push({ x: n.x - 34 + i * 14, z: n.y, rot: 0 });
      stripeSpots.push({ x: n.x, z: n.y - 34 + i * 14, rot: Math.PI / 2 });
    }
  }
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripeSpots.length);
  stripeSpots.forEach((s, i) => {
    eul.set(0, s.rot, 0);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(s.x, 0.5, s.z), q, one);
    stripes.setMatrixAt(i, m4);
  });
  scene.add(stripes);

  // Traffic lights at every other intersection, cycling on a slow timer.
  // Decorative: the traffic logic does not stop for them, but the junction
  // reads as a real one from the chase camera.
  const trafficLights = [];
  const tlPoleMat = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.6, metalness: 0.6 });
  const tlBulbGeo = new THREE.SphereGeometry(4.2, 8, 6);
  function trafficLight(x, z, faceX, faceZ, ns) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 58, 6), tlPoleMat);
    pole.position.y = 29;
    pole.castShadow = true;
    grp.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 18), tlPoleMat);
    arm.position.set(0, 56, 8);
    grp.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(13, 30, 13), tlPoleMat);
    head.position.set(0, 52, 16);
    head.castShadow = true;
    grp.add(head);
    const bulbs = {};
    const bulbCols = { red: 0xff3b30, amber: 0xffb020, green: 0x35d05a };
    let by = 64;
    for (const name of ['red', 'amber', 'green']) {
      const b = new THREE.Mesh(tlBulbGeo, new THREE.MeshBasicMaterial({ color: bulbCols[name] }));
      b.position.set(0, by, 22);
      grp.add(b);
      bulbs[name] = b;
      by -= 10;
    }
    grp.position.set(x, 0, z);
    grp.rotation.y = Math.atan2(faceX - x, faceZ - z);
    scene.add(grp);
    trafficLights.push({ bulbs, ns });
  }
  world.intersections.forEach((n, i) => {
    if (i % 2 !== 0) return;
    trafficLight(n.x - 56, n.y - 56, n.x, n.y, i % 4 === 0);
  });
  let tlPhase = -1;
  function updateTrafficLights(G) {
    // 16 s cycle: 7 s green, 1 s amber, then the other direction.
    const cycle = G.time % 16;
    const phase = cycle < 7 ? 0 : cycle < 8 ? 1 : cycle < 15 ? 2 : 3;
    if (phase === tlPhase) return;
    tlPhase = phase;
    for (const tl of trafficLights) {
      const green = tl.ns ? phase === 0 : phase === 2;
      const amber = tl.ns ? phase === 1 : phase === 3;
      tl.bulbs.red.material.color.set(green || amber ? 0x401512 : 0xff3b30);
      tl.bulbs.amber.material.color.set(amber ? 0xffb020 : 0x40300f);
      tl.bulbs.green.material.color.set(green ? 0x35d05a : 0x0f2f16);
    }
  }

  // Street name signs on green posts at a few junctions, so the city has
  // names a player can read while driving.
  function streetSign(x, z, text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1d5c3f';
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 248, 56);
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 40, 6), tlPoleMat);
    pole.position.set(x, 20, z);
    scene.add(pole);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 11),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 }),
    );
    face.position.set(x, 40, z);
    face.rotation.y = Math.PI / 4;
    scene.add(face);
  }
  const streetNames = ['SUNSET AVE', 'PALM ST', 'DOCK RD', 'OCEAN DR'];
  world.intersections.filter((n, i) => i % 6 === 2).slice(0, 4).forEach((n, k) => {
    streetSign(n.x + 56, n.y - 56, streetNames[k % streetNames.length]);
  });

  // Buildings: window-textured boxes with a roof slab. Downtown blocks rise
  // much taller, so the skyline reads from the chase camera.
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);
  // Every building's box body, roof slab and parapet rim are remembered
  // here, so the GLB swap can take them out once the real models arrive.
  const buildingMeshes = [];
  for (const b of world.buildings) {
    const tall = b.tall;
    const hgt = tall ? 150 + hash01(b.x, b.y) * 230 : 38 + hash01(b.x, b.y) * 72;
    const winTex = winTexes[Math.floor(hash01(b.x + 1, b.y + 4) * 5) % 5];
    const body = new THREE.Mesh(boxGeo, buildingMaterial(b.color, b.w, hgt, winTex));
    body.scale.set(b.w, hgt, b.h);
    body.position.set(b.x + b.w / 2, hgt / 2, b.y + b.h / 2);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    const roofMat = new THREE.MeshStandardMaterial({ color: hexColor(b.roof), roughness: 0.9, metalness: 0.05 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.scale.set(b.w + 3, 5, b.h + 3);
    roof.position.set(b.x + b.w / 2, hgt + 2, b.y + b.h / 2);
    roof.castShadow = true;
    scene.add(roof);
    // A raised parapet rim around the roof edge, so the roof reads as a
    // finished slab from the chase camera instead of a flat box top.
    const rim = new THREE.Mesh(roofGeo, roofMat);
    rim.scale.set(b.w + 7, 5, b.h + 7);
    rim.position.set(b.x + b.w / 2, hgt + 5, b.y + b.h / 2);
    rim.castShadow = true;
    scene.add(rim);
    const bldRec = { b, hgt, body, roof, rim, pyr: null };
    buildingMeshes.push(bldRec);
    // Rooftop clutter: an AC box on most roofs, a water tank on some.
    const rh = hash01(b.x + 3, b.y + 7);
    if (rh < 0.45) {
      const ac = new THREE.Mesh(
        new THREE.BoxGeometry(18, 8, 14),
        new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.6, metalness: 0.4 }),
      );
      ac.position.set(b.x + b.w / 2 + (rh - 0.22) * b.w * 0.4, hgt + 11, b.y + b.h / 2);
      ac.castShadow = true;
      scene.add(ac);
    } else if (rh < 0.65) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(8, 8, 16, 10),
        new THREE.MeshStandardMaterial({ color: 0x7d8a94, roughness: 0.5, metalness: 0.5 }),
      );
      tank.position.set(b.x + b.w / 2, hgt + 15, b.y + b.h / 2);
      tank.castShadow = true;
      scene.add(tank);
      const tankTop = new THREE.Mesh(
        new THREE.ConeGeometry(9, 6, 10),
        new THREE.MeshStandardMaterial({ color: 0x5d6b76, roughness: 0.6, metalness: 0.4 }),
      );
      tankTop.position.set(b.x + b.w / 2, hgt + 26, b.y + b.h / 2);
      scene.add(tankTop);
    }
    // Balconies on some residential blocks: a slab and a railing on the
    // street-facing side, so the facade is not one flat wall.
    if (!tall && hash01(b.x + 5, b.y + 11) < 0.35) {
      const balcMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85, metalness: 0.1 });
      const railMat = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.6, metalness: 0.5 });
      for (const fy of [18, 36]) {
        if (fy > hgt - 8) continue;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.4, 2, 10), balcMat);
        slab.position.set(b.x + b.w / 2, fy, b.y + b.h + 5);
        slab.castShadow = true;
        scene.add(slab);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.4, 6, 1.5), railMat);
        rail.position.set(b.x + b.w / 2, fy + 4, b.y + b.h + 9);
        scene.add(rail);
      }
    }
    // Rooftop antennas on some tall blocks: a thin mast with crossbars.
    if (tall && hash01(b.x + 21, b.y + 17) < 0.5) {
      const antMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.7 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 42, 6), antMat);
      mast.position.set(b.x + b.w * 0.3, hgt + 26, b.y + b.h * 0.3);
      scene.add(mast);
      for (const ay of [hgt + 34, hgt + 42]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(20, 1.5, 1.5), antMat);
        bar.position.set(b.x + b.w * 0.3, ay, b.y + b.h * 0.3);
        scene.add(bar);
      }
    }
    // Downtown shopfronts: a striped awning and a lit sign strip on the
    // street-facing side of about half the tall blocks.
    if (tall && hash01(b.x + 9, b.y + 2) < 0.5) {
      const awnColors = ['#d94f4f', '#2f7a4f', '#2f5f9e', '#c98a2f'];
      const awn = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.55, 2, 16),
        new THREE.MeshStandardMaterial({ color: hexColor(awnColors[Math.floor(hash01(b.x, b.y + 5) * 4) % 4]), roughness: 0.8, metalness: 0 }),
      );
      awn.rotation.x = -0.32;
      awn.position.set(b.x + b.w / 2, 15, b.y + b.h + 8);
      awn.castShadow = true;
      scene.add(awn);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.55, 7, 2),
        new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc860, emissiveIntensity: 0.55 }),
      );
      sign.position.set(b.x + b.w / 2, 28, b.y + b.h + 1);
      scene.add(sign);
      // A glass storefront band under the awning, glowing faintly.
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(b.w * 0.55, 10),
        new THREE.MeshStandardMaterial({ color: 0x9fd8e8, emissive: 0x2a4a5a, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.6 }),
      );
      glass.position.set(b.x + b.w / 2, 8, b.y + b.h + 0.6);
      scene.add(glass);
    }
    // Landmarks the player navigates by: a red cross on the hospital roof,
    // columns at the bank, a pyramid roof on the safehouse, a yellow sign
    // strip on the garage.
    if (b.kind === 'hospital') {
      const crossMat = new THREE.MeshBasicMaterial({ color: 0xe5534b });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 26), crossMat);
      c1.position.set(b.x + b.w / 2, hgt + 6, b.y + b.h / 2);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 8), crossMat);
      c2.position.set(b.x + b.w / 2, hgt + 6, b.y + b.h / 2);
      scene.add(c1);
      scene.add(c2);
    }
    if (b.kind === 'bank') {
      const colMat = new THREE.MeshLambertMaterial({ color: hexColor('#f2e8c9') });
      for (let i = 0; i < 4; i += 1) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 8), colMat);
        col.position.set(b.x + 14 + (i * (b.w - 28)) / 3, 15, b.y + b.h + 4);
        col.castShadow = true;
        scene.add(col);
      }
    }
    if (b.kind === 'house') {
      const pyr = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(b.w, b.h) * 0.72, 22, 4),
        new THREE.MeshLambertMaterial({ color: hexColor('#b8543f') }),
      );
      pyr.rotation.y = Math.PI / 4;
      pyr.position.set(b.x + b.w / 2, hgt + 15, b.y + b.h / 2);
      pyr.castShadow = true;
      scene.add(pyr);
      // The safehouse pyramid is a roof: the GLB house brings its own.
      bldRec.pyr = pyr;
    }
    if (b.kind === 'garage') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.6, 8, 2),
        new THREE.MeshBasicMaterial({ color: 0xe8c33f }),
      );
      sign.position.set(b.x + b.w / 2, hgt + 8, b.y + b.h + 2);
      scene.add(sign);
    }
  }

  // Chimneys on a few mid-rise roofs, with smoke puffs that rise, spread
  // and fade in the update loop.
  const chimneys = [];
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x8a6f5a, roughness: 0.9, metalness: 0 });
  for (const rec of buildingMeshes) {
    if (chimneys.length >= 4) break;
    if (rec.b.tall || hash01(rec.b.x + 31, rec.b.y + 13) > 0.12) continue;
    const ch = new THREE.Mesh(new THREE.BoxGeometry(9, 16, 9), chimneyMat);
    ch.position.set(rec.b.x + rec.b.w * 0.3, rec.hgt + 8, rec.b.y + rec.b.h * 0.3);
    ch.castShadow = true;
    scene.add(ch);
    chimneys.push({ x: rec.b.x + rec.b.w * 0.3, y: rec.hgt + 16, z: rec.b.y + rec.b.h * 0.3 });
  }
  const smokePuffs = [];
  const smokeGeo = new THREE.SphereGeometry(1, 6, 5);
  for (let i = 0; i < 16; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.3, depthWrite: false });
    const puff = new THREE.Mesh(smokeGeo, mat);
    puff.visible = false;
    scene.add(puff);
    smokePuffs.push({ mesh: puff, mat, chimney: chimneys[i % Math.max(1, chimneys.length)], age: (i / 16) * 6, dur: 6 });
  }

  // Neon signs on three downtown towers: canvas text with a glow, flickering
  // in the update loop like real neon.
  const neonSigns = [];
  const neonDefs = [
    { text: 'BAR', color: '#ff2d95' },
    { text: 'HOTEL', color: '#22d3ee' },
    { text: 'PIZZA', color: '#ffd166' },
  ];
  buildingMeshes.filter((rec) => rec.b.tall).slice(0, 3).forEach((rec, k) => {
    const def = neonDefs[k % neonDefs.length];
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#14141c';
    g.fillRect(0, 0, 256, 64);
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = def.color;
    g.shadowBlur = 18;
    g.fillStyle = def.color;
    g.fillText(def.text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(64, 16), mat);
    sign.position.set(rec.b.x + rec.b.w / 2, 42, rec.b.y + rec.b.h + 1.2);
    scene.add(sign);
    neonSigns.push({ mat, phase: k * 2.1 });
  });

  // Shipping containers in the docks yard.
  for (const c of world.containers) {
    const box = new THREE.Mesh(
      boxGeo,
      new THREE.MeshLambertMaterial({ color: hexColor(c.color) }),
    );
    box.scale.set(c.w, 26, c.h);
    box.position.set(c.x + c.w / 2, 13, c.y + c.h / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
  }

  // Trees and palms. Trunks and canopies share a few geometries; each tree
  // is two or three cheap meshes, and the whole city has only a few dozen.
  const trunkGeo = new THREE.CylinderGeometry(3, 4.5, 16, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: hexColor('#6f4f2f'), roughness: 0.95, metalness: 0 });
  const leafGeo = new THREE.SphereGeometry(13, 8, 6);
  const leafMat = new THREE.MeshStandardMaterial({ color: hexColor('#4d8f3d'), roughness: 0.9, metalness: 0 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: hexColor('#5da34e'), roughness: 0.9, metalness: 0 });
  const palmTrunkGeo = new THREE.CylinderGeometry(2.5, 4, 26, 7);
  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: hexColor('#8a6f4d'), roughness: 0.95, metalness: 0 });
  const palmLeafGeo = new THREE.ConeGeometry(7, 26, 5);
  const palmLeafMat = new THREE.MeshStandardMaterial({ color: hexColor('#3f8f3a'), roughness: 0.85, metalness: 0 });
  const palmLeafMat2 = new THREE.MeshStandardMaterial({ color: hexColor('#2f7a33'), roughness: 0.85, metalness: 0 });
  // Every palm frond is remembered with its rest pose, so the update loop
  // can sway the crowns gently in the sea breeze.
  const palmFronds = [];
  for (const t of world.trees) {
    if (t.palm) {
      const trunk = new THREE.Mesh(palmTrunkGeo, palmTrunkMat);
      trunk.position.set(t.x, 13, t.y);
      trunk.rotation.z = 0.12;
      trunk.castShadow = true;
      scene.add(trunk);
      // Two tiers of drooping fronds, so the crown reads as a full palm
      // instead of a bare spike, plus a small cluster of coconuts.
      for (let i = 0; i < 6; i += 1) {
        const leaf = new THREE.Mesh(palmLeafGeo, palmLeafMat);
        const a = (i / 6) * Math.PI * 2;
        leaf.position.set(t.x + 4 + Math.cos(a) * 8, 30, t.y + Math.sin(a) * 8);
        leaf.rotation.set(Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0 + 0.5);
        leaf.castShadow = true;
        scene.add(leaf);
        palmFronds.push({ mesh: leaf, rx: leaf.rotation.x, rz: leaf.rotation.z, phase: hash01(t.x, t.y) * 6.28 });
      }
      for (let i = 0; i < 4; i += 1) {
        const leaf = new THREE.Mesh(palmLeafGeo, palmLeafMat2);
        leaf.scale.set(0.7, 0.7, 0.7);
        const a = (i / 4) * Math.PI * 2 + 0.6;
        leaf.position.set(t.x + 3 + Math.cos(a) * 5, 37, t.y + Math.sin(a) * 5);
        leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6 + 0.3);
        scene.add(leaf);
        palmFronds.push({ mesh: leaf, rx: leaf.rotation.x, rz: leaf.rotation.z, phase: hash01(t.x + 9, t.y + 4) * 6.28 });
      }
      for (let i = 0; i < 3; i += 1) {
        const nut = new THREE.Mesh(
          new THREE.SphereGeometry(2.6, 7, 6),
          new THREE.MeshStandardMaterial({ color: 0x6f4f2f, roughness: 0.9, metalness: 0 }),
        );
        nut.position.set(t.x + (i - 1) * 4, 26, t.y + 3);
        scene.add(nut);
      }
      continue;
    }
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(t.x, 8, t.y);
    trunk.castShadow = true;
    scene.add(trunk);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(t.x, 24, t.y);
    leaf.castShadow = true;
    scene.add(leaf);
    const leaf2 = new THREE.Mesh(leafGeo, leafMat2);
    leaf2.scale.set(0.65, 0.65, 0.65);
    leaf2.position.set(t.x - 6, 30, t.y - 3);
    scene.add(leaf2);
  }

  // Street furniture, placed deterministically so the same seed always gets
  // the same lamps, benches, signs and beach umbrellas.
  const lampPoleGeo = new THREE.CylinderGeometry(1.6, 2.2, 44, 6);
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.6, metalness: 0.6 });
  const lampHeadGeo = new THREE.SphereGeometry(4, 8, 6);
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffdf8a, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0 });
  function streetLamp(x, z, armAlongX) {
    const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
    pole.position.set(x, 22, z);
    pole.castShadow = true;
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armAlongX ? 16 : 2, 2, armAlongX ? 2 : 16), lampPoleMat);
    arm.position.set(x, 43, z);
    scene.add(arm);
    const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
    head.position.set(x, 42, z);
    scene.add(head);
  }
  for (const vx of [V_ROADS[2], V_ROADS[3]]) {
    const cx = vx * TILE + ROAD_W / 2;
    for (let y = 150; y < SAND_TOP - 60; y += 330) {
      const side = (Math.floor(y / 330) % 2 === 0) ? 1 : -1;
      streetLamp(cx + side * (ROAD_W / 2 + 8), y, false);
    }
  }
  for (const hy of [H_ROADS[1]]) {
    const cy = hy * TILE + ROAD_W / 2;
    for (let x = 150; x < WORLD_W - 60; x += 330) {
      const side = (Math.floor(x / 330) % 2 === 0) ? 1 : -1;
      streetLamp(x, cy + side * (ROAD_W / 2 + 8), true);
    }
  }
  const benchWood = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.85, metalness: 0 });
  const benchIron = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.6, metalness: 0.6 });
  function bench(x, y, rotY) {
    const grp = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 12), benchWood);
    seat.position.y = 8;
    seat.castShadow = true;
    grp.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 3), benchWood);
    back.position.set(0, 15, -5);
    grp.add(back);
    for (const lx of [-12, 12]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 10), benchIron);
      leg.position.set(lx, 4, 0);
      grp.add(leg);
    }
    grp.position.set(x, 0, y);
    grp.rotation.y = rotY;
    scene.add(grp);
  }
  for (let i = 0; i < 4; i += 1) bench(world.park.x + 40 + i * 60, world.park.y + 50, 0);
  for (let i = 0; i < 4; i += 1) bench(500 + i * 320, SAND_TOP - 26, Math.PI);
  const signPoleGeo = new THREE.CylinderGeometry(1.4, 1.4, 34, 6);
  const signFaceGeo = new THREE.PlaneGeometry(16, 16);
  const signMats = [0x2f6fb2, 0xd94f4f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }));
  world.intersections.filter((n, i) => i % 4 === 0).forEach((n, k) => {
    const pole = new THREE.Mesh(signPoleGeo, lampPoleMat);
    pole.position.set(n.x + 52, 17, n.y + 52);
    scene.add(pole);
    const face = new THREE.Mesh(signFaceGeo, signMats[k % 2]);
    face.position.set(n.x + 52, 32, n.y + 52);
    face.rotation.y = Math.PI / 4;
    scene.add(face);
  });
  // Beach umbrellas and towels on the sand, clustered near the beach spot
  // the foot screenshot frames so that shot reads busy, not empty.
  const umbrellaColors = ['#d94f4f', '#2f7a9e', '#e8c33f', '#c96ad9'];
  function umbrella(x, y, colorCss) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 34, 6), benchIron);
    pole.position.set(x, 17, y);
    pole.castShadow = true;
    scene.add(pole);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(26, 12, 8),
      new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    );
    top.position.set(x, 38, y);
    top.castShadow = true;
    scene.add(top);
  }
  function towel(x, y, colorCss) {
    const t = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 34),
      new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.95, metalness: 0 }),
    );
    t.rotation.x = -Math.PI / 2;
    t.rotation.z = hash01(x, y) * 0.8 - 0.4;
    t.position.set(x, 0.6, y);
    scene.add(t);
  }
  const beachSpot = world.places.beach;
  for (let i = 0; i < 6; i += 1) {
    const ux = beachSpot.x - 260 + i * 110 + hash01(i, 3) * 40;
    const uy = beachSpot.y + 10 + hash01(i, 7) * 70;
    umbrella(ux, uy, umbrellaColors[i % 4]);
    towel(ux + 34, uy + 18, umbrellaColors[(i + 2) % 4]);
  }
  for (let i = 0; i < 6; i += 1) {
    const ux = 200 + hash01(i, 11) * (WORLD_W - 400);
    const uy = SAND_TOP + 50 + hash01(i, 13) * 70;
    umbrella(ux, uy, umbrellaColors[(i + 1) % 4]);
    towel(ux + 34, uy + 16, umbrellaColors[(i + 3) % 4]);
  }

  // Market stalls on four downtown corners: a table, a striped awning and
  // bright goods. A vendor stands behind each one (built lazily with the
  // static people, once the person model has loaded).
  const vendorSpots = [];
  function stallAwningTexture(colorCss) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i += 1) {
      g.fillStyle = i % 2 === 0 ? colorCss : '#f2ede2';
      g.fillRect(i * 16, 0, 16, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  const stallColors = ['#d94f4f', '#2f7a4f', '#2f5f9e', '#c98a2f'];
  const stallSpots = [
    { tx: V_ROADS[2], ty: H_ROADS[0] },
    { tx: V_ROADS[3], ty: H_ROADS[0] },
    { tx: V_ROADS[2], ty: H_ROADS[1] },
    { tx: V_ROADS[3], ty: H_ROADS[1] },
  ];
  for (let k = 0; k < stallSpots.length; k += 1) {
    const sx = stallSpots[k].tx * TILE + ROAD_W / 2 + 66;
    const sz = stallSpots[k].ty * TILE + ROAD_W / 2 + 66;
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(36, 4, 22),
      new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.85, metalness: 0 }),
    );
    table.position.set(sx, 9, sz);
    table.castShadow = true;
    scene.add(table);
    for (const [lx, lz] of [[-15, -8], [15, -8], [-15, 8], [15, 8]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 9, 3), benchIron);
      leg.position.set(sx + lx, 4.5, sz + lz);
      scene.add(leg);
    }
    const awn = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 26),
      new THREE.MeshStandardMaterial({ map: stallAwningTexture(stallColors[k % 4]), roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    );
    awn.rotation.x = -Math.PI / 2 - 0.3;
    awn.position.set(sx, 30, sz);
    awn.castShadow = true;
    scene.add(awn);
    for (let i = 0; i < 2; i += 1) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 26, 6), benchIron);
      post.position.set(sx - 18 + i * 36, 13, sz + 10);
      scene.add(post);
    }
    // Goods on the table: fruit and boxes in bright colours.
    const goodsColors = [0xd94f4f, 0x4f9e3a, 0xe8c33f, 0xe8862f, 0xc96ad9, 0x2f6fb2];
    for (let i = 0; i < 6; i += 1) {
      const good = new THREE.Mesh(
        new THREE.SphereGeometry(3, 8, 6),
        new THREE.MeshStandardMaterial({ color: goodsColors[(k + i) % goodsColors.length], roughness: 0.6, metalness: 0 }),
      );
      good.position.set(sx - 12 + i * 5, 13.5, sz - 4 + (i % 2) * 8);
      good.castShadow = true;
      scene.add(good);
    }
    for (let i = 0; i < 2; i += 1) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(9, 7, 9),
        new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.9, metalness: 0 }),
      );
      crate.position.set(sx - 10 + i * 22, 14.5, sz + 8);
      crate.castShadow = true;
      scene.add(crate);
    }
    vendorSpots.push({ x: sx, z: sz + 16, angle: Math.PI });
  }
  // A food cart in the park corner: a box on two wheels with an umbrella.
  const cart = new THREE.Group();
  const cartBody = new THREE.Mesh(
    new THREE.BoxGeometry(30, 16, 18),
    new THREE.MeshStandardMaterial({ color: 0xe8c33f, roughness: 0.7, metalness: 0.1 }),
  );
  cartBody.position.y = 12;
  cartBody.castShadow = true;
  cart.add(cartBody);
  const cartWheelGeo = new THREE.CylinderGeometry(5, 5, 3, 10);
  for (const wz of [-10, 10]) {
    const w = new THREE.Mesh(cartWheelGeo, benchIron);
    w.rotation.x = Math.PI / 2;
    w.position.set(0, 5, wz);
    cart.add(w);
  }
  const cartUmbrella = new THREE.Mesh(
    new THREE.ConeGeometry(20, 10, 8),
    new THREE.MeshStandardMaterial({ color: hexColor('#d94f4f'), roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
  );
  cartUmbrella.position.y = 28;
  cart.add(cartUmbrella);
  cart.position.set(world.park.x + 60, 0, world.park.y + 60);
  scene.add(cart);

  // A beach ball at the water's edge, bobbing in the surf.
  const ballCanvas = document.createElement('canvas');
  ballCanvas.width = 128;
  ballCanvas.height = 64;
  const bg = ballCanvas.getContext('2d');
  const ballCols = ['#d94f4f', '#f2ede2', '#2f6fb2', '#f2ede2', '#e8c33f', '#f2ede2'];
  for (let i = 0; i < 6; i += 1) {
    bg.fillStyle = ballCols[i];
    bg.fillRect(i * 22, 0, 22, 64);
  }
  const ballTex = new THREE.CanvasTexture(ballCanvas);
  ballTex.encoding = THREE.sRGBEncoding;
  const beachBall = new THREE.Mesh(
    new THREE.SphereGeometry(7, 12, 10),
    new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.5, metalness: 0 }),
  );
  beachBall.position.set(beachSpot.x + 180, 7, SAND_TOP + 42);
  beachBall.castShadow = true;
  scene.add(beachBall);

  // Flags on poles at four downtown junctions, waving in the breeze.
  const flags = [];
  const flagColors = ['#d94f4f', '#2f6fb2', '#e8c33f', '#3a8f5a'];
  const flagPoleGeo = new THREE.CylinderGeometry(1.4, 1.8, 46, 6);
  const flagGeo = new THREE.PlaneGeometry(26, 15);
  flagGeo.translate(13, 0, 0);
  world.intersections.filter((n, i) => i % 8 === 3).slice(0, 4).forEach((n, k) => {
    const pole = new THREE.Mesh(flagPoleGeo, lampPoleMat);
    pole.position.set(n.x - 52, 23, n.y - 52);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(
      flagGeo,
      new THREE.MeshStandardMaterial({ color: hexColor(flagColors[k % 4]), roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    );
    flag.position.set(n.x - 52, 42, n.y - 52);
    flag.castShadow = true;
    scene.add(flag);
    flags.push({ mesh: flag, phase: k * 1.7 });
  });

  // Realistic clouds: soft canvas-textured billboards, layered at three
  // altitudes and drifting at different speeds, denser near the horizon.
  // Sprites always face the camera, so they read as clouds from any angle.
  // They sit far out over the sea and the city (and ignore fog, like the
  // sky dome) so they actually fall inside the screenshot cameras' narrow
  // sky band instead of floating above the frame.
  const cloudTex = makeCloudTexture();
  const clouds = [];
  const cloudLanes = [
    { y: 320, n: 6, wMin: 320, wMax: 560, speedMin: 4, speedMax: 7, opMin: 0.6, opMax: 0.85 },
    { y: 430, n: 6, wMin: 280, wMax: 500, speedMin: 6, speedMax: 10, opMin: 0.7, opMax: 0.95 },
    { y: 560, n: 6, wMin: 240, wMax: 420, speedMin: 8, speedMax: 12, opMin: 0.55, opMax: 0.8 },
  ];
  cloudLanes.forEach((lane, li) => {
    for (let i = 0; i < lane.n; i += 1) {
      const base = lane.opMin + hash01(li * 7 + i, 3) * (lane.opMax - lane.opMin);
      const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: base });
      const spr = new THREE.Sprite(mat);
      const w = lane.wMin + hash01(i * 3 + li, 11) * (lane.wMax - lane.wMin);
      spr.scale.set(w, w * 0.42, 1);
      spr.position.set(
        -500 + hash01(i, li * 5 + 1) * (WORLD_W + 1400),
        lane.y + hash01(i * 2, li) * 60,
        -400 + hash01(i * 5, li * 3 + 2) * (WORLD_H + 2100),
      );
      scene.add(spr);
      clouds.push({ spr, speed: lane.speedMin + hash01(i, li + 9) * (lane.speedMax - lane.speedMin), base });
    }
  });

  // Birds crossing the sky: a dark body with two flapping wings, looping
  // across the city on fixed lanes so the sky is never still.
  const birds = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2e3138, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i += 1) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 3), birdMat);
    grp.add(body);
    const wingL = new THREE.Group();
    wingL.position.set(0, 0, 2);
    const wingLm = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 12), birdMat);
    wingLm.position.set(0, 0, 6);
    wingL.add(wingLm);
    grp.add(wingL);
    const wingR = new THREE.Group();
    wingR.position.set(0, 0, -2);
    const wingRm = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 12), birdMat);
    wingRm.position.set(0, 0, -6);
    wingR.add(wingRm);
    grp.add(wingR);
    grp.position.set(-320 + i * 160, 300 + (i % 3) * 45, 250 + i * 260);
    scene.add(grp);
    birds.push({ grp, wingL, wingR, speed: 55 + i * 9, phase: i * 1.3 });
  }

  // Pickups: glowing floating health crosses and ammo boxes, one group each,
  // hidden while taken and shown again when they respawn.
  const pickupGroups = new Map();
  for (const p of world.pickups) {
    const grp = new THREE.Group();
    if (p.kind === 'health') {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(20, 20, 4),
        new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2f7a3d }),
      );
      box.position.y = 10;
      grp.add(box);
      const c1 = new THREE.Mesh(
        new THREE.BoxGeometry(5, 15, 5),
        new THREE.MeshLambertMaterial({ color: 0x37b24d, emissive: 0x1d6a2c }),
      );
      c1.position.y = 10;
      const c2 = new THREE.Mesh(
        new THREE.BoxGeometry(15, 5, 5),
        new THREE.MeshLambertMaterial({ color: 0x37b24d, emissive: 0x1d6a2c }),
      );
      c2.position.y = 10;
      grp.add(c1);
      grp.add(c2);
    } else {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(22, 15, 14),
        new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x6a5200 }),
      );
      box.position.y = 8;
      grp.add(box);
      for (let i = -1; i <= 1; i += 1) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(3, 9, 15),
          new THREE.MeshLambertMaterial({ color: 0x1c1e26 }),
        );
        stripe.position.set(i * 7, 8, 0);
        grp.add(stripe);
      }
    }
    grp.position.set(p.x, 0, p.y);
    scene.add(grp);
    pickupGroups.set(p, grp);
  }

  // Aircraft: a helicopter (police or the player's red one), a light prop
  // plane, and the floating weapon crates. Rotors spin, police lights flash,
  // nav lights blink; the groups are built once and repositioned per frame.
  function buildHelicopter(police) {
    const grp = new THREE.Group();
    grp.rotation.order = 'YXZ';
    const paint = police ? '#f2f2f2' : '#d94f4f';
    const bodyMat = new THREE.MeshStandardMaterial({ color: hexColor(paint), roughness: 0.35, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 22), bodyMat);
    body.position.y = 12;
    body.castShadow = true;
    grp.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 20), bodyMat);
    nose.position.set(20, 10, 0);
    nose.castShadow = true;
    grp.add(nose);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1420, roughness: 0.08, metalness: 0.9 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 18), glassMat);
    glass.position.set(18, 13, 0);
    grp.add(glass);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(34, 5, 5), bodyMat);
    boom.position.set(-30, 14, 0);
    boom.castShadow = true;
    grp.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 8), bodyMat);
    fin.position.set(-45, 18, 0);
    grp.add(fin);
    const tailRotor = new THREE.Group();
    const trBladeGeo = new THREE.BoxGeometry(1, 16, 2);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const trBlade = new THREE.Mesh(trBladeGeo, bladeMat);
    tailRotor.add(trBlade);
    const trBlade2 = new THREE.Mesh(trBladeGeo, bladeMat);
    trBlade2.rotation.x = Math.PI / 2;
    tailRotor.add(trBlade2);
    tailRotor.position.set(-46, 18, 4);
    grp.add(tailRotor);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 8), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 }));
    mast.position.y = 22;
    grp.add(mast);
    const rotor = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(64, 1, 5);
    const b1 = new THREE.Mesh(bladeGeo, bladeMat);
    rotor.add(b1);
    const b2 = new THREE.Mesh(bladeGeo, bladeMat);
    b2.rotation.y = Math.PI / 2;
    rotor.add(b2);
    rotor.position.y = 26;
    grp.add(rotor);
    const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    for (const sz of [-11, 11]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 2), skidMat);
      skid.position.set(0, 2, sz);
      grp.add(skid);
      for (const sx of [-12, 12]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), skidMat);
        strut.position.set(sx, 5, sz);
        grp.add(strut);
      }
    }
    let barRed = null;
    let barBlue = null;
    if (police) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(36, 4, 23),
        new THREE.MeshStandardMaterial({ color: 0x2a4fd9, roughness: 0.4, metalness: 0.4 }),
      );
      stripe.position.set(0, 8, 0);
      grp.add(stripe);
      barRed = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      barRed.position.set(0, 21, -4);
      grp.add(barRed);
      barBlue = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial({ color: 0x3b82ff }));
      barBlue.position.set(0, 21, 4);
      grp.add(barBlue);
    }
    grp.userData.rotor = rotor;
    grp.userData.tailRotor = tailRotor;
    grp.userData.barRed = barRed;
    grp.userData.barBlue = barBlue;
    grp.userData.rotorSpin = 0;
    return grp;
  }

  function buildPlaneMesh(colorCss) {
    const grp = new THREE.Group();
    grp.rotation.order = 'YXZ';
    const paint = new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.35, metalness: 0.5 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 52, 10), paint);
    fus.rotation.z = Math.PI / 2;
    fus.position.y = 10;
    fus.castShadow = true;
    grp.add(fus);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(7, 14, 10), paint);
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(33, 10, 0);
    grp.add(nose);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(7, 10, 10), paint);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-30, 10, 0);
    grp.add(tail);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.4 });
    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 1.5, 64), wingMat);
    wing.position.set(2, 9, 0);
    wing.castShadow = true;
    grp.add(wing);
    const tailWing = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 26), wingMat);
    tailWing.position.set(-28, 11, 0);
    grp.add(tailWing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 1.5), paint);
    fin.position.set(-28, 18, 0);
    grp.add(fin);
    const prop = new THREE.Group();
    const propBladeGeo = new THREE.BoxGeometry(1, 18, 2);
    const propMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const pb1 = new THREE.Mesh(propBladeGeo, propMat);
    prop.add(pb1);
    const pb2 = new THREE.Mesh(propBladeGeo, propMat);
    pb2.rotation.x = Math.PI / 2;
    prop.add(pb2);
    prop.position.set(40, 10, 0);
    grp.add(prop);
    const navRed = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    navRed.position.set(2, 9, -32);
    grp.add(navRed);
    const navGreen = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35d05a }));
    navGreen.position.set(2, 9, 32);
    grp.add(navGreen);
    const contrail = new THREE.Mesh(
      new THREE.BoxGeometry(280, 2, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    contrail.position.set(-170, 10, 0);
    grp.add(contrail);
    grp.userData.prop = prop;
    grp.userData.propSpin = 0;
    grp.userData.navRed = navRed;
    grp.userData.navGreen = navGreen;
    return grp;
  }

  function buildWeaponPickupMesh(kind) {
    const grp = new THREE.Group();
    const colors = { shotgun: 0x8a5a2a, rifle: 0x2a4a6a, rocket: 0x6a2a2a };
    const mat = new THREE.MeshStandardMaterial({ color: colors[kind] || 0x555555, roughness: 0.4, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.5, metalness: 0.5 });
    if (kind === 'rocket') {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 8), mat);
      tube.rotation.z = Math.PI / 2;
      tube.position.y = 8;
      grp.add(tube);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 8), dark);
      cone.rotation.z = -Math.PI / 2;
      cone.position.set(20, 8, 0);
      grp.add(cone);
    } else if (kind === 'shotgun') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 26, 8), dark);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(8, 10, 0);
      grp.add(barrel);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 4), mat);
      stock.position.set(-8, 8, 0);
      grp.add(stock);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 4), mat);
      body.position.set(0, 10, 0);
      grp.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 16, 8), dark);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(18, 10, 0);
      grp.add(barrel);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 3), dark);
      mag.position.set(2, 5, 0);
      grp.add(mag);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(16, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    grp.add(ring);
    // A touch smaller than life, so the crate reads as a pickup and not
    // as debris lying in the road.
    grp.scale.setScalar(0.8);
    return grp;
  }

  // The helipad on the east beach: a dark circle, a white ring and a flat H.
  const helipad = new THREE.Group();
  const padDisc = new THREE.Mesh(new THREE.CircleGeometry(52, 24), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9, metalness: 0 }));
  padDisc.rotation.x = -Math.PI / 2;
  padDisc.position.y = 0.4;
  helipad.add(padDisc);
  const padRing = new THREE.Mesh(new THREE.RingGeometry(46, 52, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.5;
  helipad.add(padRing);
  const hBarMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [hx, hw, hh] of [[-14, 6, 34], [14, 6, 34], [0, 34, 6]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(hw, 1, hh), hBarMat);
    bar.position.set(hx, 0.6, 0);
    helipad.add(bar);
  }
  helipad.position.set(HELIPAD.x, 0, HELIPAD.y);
  scene.add(helipad);

  // A windsock at the west end of the beach strip, marking the plane's runway.
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 60, 6), tlPoleMat);
  sockPole.position.set(AIRSTRIP.x + 60, 30, AIRSTRIP.y - 30);
  scene.add(sockPole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(7, 26, 8), new THREE.MeshStandardMaterial({ color: 0xe8862f, roughness: 0.7, metalness: 0 }));
  sock.rotation.z = Math.PI / 2;
  sock.position.set(AIRSTRIP.x + 74, 56, AIRSTRIP.y - 30);
  scene.add(sock);

  // The aircraft groups, built once and repositioned every frame.
  const flyHeliGroup = buildHelicopter(false);
  scene.add(flyHeliGroup);
  const policeHeliGroup = buildHelicopter(true);
  scene.add(policeHeliGroup);
  const flyPlaneGroup = buildPlaneMesh('#e8862f');
  scene.add(flyPlaneGroup);
  const ambientPlaneGroups = [buildPlaneMesh('#e8e8e8'), buildPlaneMesh('#4f7ed9'), buildPlaneMesh('#d94f4f')];
  for (const g of ambientPlaneGroups) scene.add(g);
  const weaponPickupGroups = new Map();

  // The police helicopter's searchlight: a translucent cone from the
  // chopper to the ground, plus a bright pool where it lands. Night only.
  const searchCone = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 70, 260, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  searchCone.visible = false;
  scene.add(searchCone);
  const searchSpot = new THREE.Mesh(
    new THREE.CircleGeometry(70, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  searchSpot.rotation.x = -Math.PI / 2;
  searchSpot.visible = false;
  scene.add(searchSpot);

  // GPS markers: a trail of small glowing chevrons along the route to the
  // mission target, plus a pulsing ring and a light beam at the target.
  const GPS_N = 48;
  const gpsMarkers = [];
  const gpsGeo = new THREE.BoxGeometry(20, 2.5, 20);
  // Cyan, not gold: gold chevrons disappear against the yellow lane
  // dashes, while cyan reads as a route from the chase camera. The target
  // itself stays gold (ring and beam below).
  const gpsMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.95 });
  for (let i = 0; i < GPS_N; i += 1) {
    const m = new THREE.Mesh(gpsGeo, gpsMat);
    m.visible = false;
    scene.add(m);
    gpsMarkers.push(m);
  }
  const beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(20, 30, 24),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 1;
  beaconRing.visible = false;
  scene.add(beaconRing);
  const beaconBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 150, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  beaconBeam.position.y = 75;
  beaconBeam.visible = false;
  scene.add(beaconBeam);

  // Small effect pools, reused every frame instead of allocating meshes.
  const bulletPool = [];
  for (let i = 0; i < 24; i += 1) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(18, 2, 2),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    );
    m.visible = false;
    scene.add(m);
    bulletPool.push(m);
  }
  const particlePool = [];
  for (let i = 0; i < 60; i += 1) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    m.visible = false;
    scene.add(m);
    particlePool.push(m);
  }
  const skidPool = [];
  for (let i = 0; i < 60; i += 1) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 9),
      new THREE.MeshBasicMaterial({ color: 0x141418, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    skidPool.push(m);
  }

  // Cars: a box body, a dark cabin, four spinning wheels, headlights and
  // taillights. Police cars get a light bar that flashes red and blue.
  const carBodyGeo = new THREE.BoxGeometry(46, 7, 24);
  const carCabinGeo = new THREE.BoxGeometry(20, 8, 20);
  const wheelGeo = new THREE.CylinderGeometry(6, 6, 4, 10);
  const lightGeo = new THREE.BoxGeometry(3, 3, 5);
  const carGroups = new Map();

  // Real 3D models (vendored GLB files, loaded offline): Kenney cars (CC0)
  // plus the Cesium milk truck (CC-BY 4.0), a realistic MakeHuman person
  // (CC0) and Kenney city buildings (CC0). Sources and licences are listed
  // in MODELS.md. The procedural builders stay as the fallback: if a file
  // fails to load, or the loader script is missing, the game keeps showing
  // the old models.
  const PERSON_HEIGHT = 34;
  const MODEL_FILES = {
    sedan: { file: 'models/kenney-sedan.glb', kind: 'car' },
    sports: { file: 'models/kenney-sedan-sports.glb', kind: 'car' },
    suv: { file: 'models/kenney-suv.glb', kind: 'car' },
    taxi: { file: 'models/kenney-taxi.glb', kind: 'car' },
    pickup: { file: 'models/kenney-truck.glb', kind: 'car' },
    police: { file: 'models/kenney-police.glb', kind: 'car' },
    truck: { file: 'models/CesiumMilkTruck.glb', kind: 'car' },
    person: { file: 'models/human-player.glb', kind: 'person' },
    'bld-a': { file: 'models/buildings/building-a.glb', kind: 'building' },
    'bld-b': { file: 'models/buildings/building-b.glb', kind: 'building' },
    'bld-c': { file: 'models/buildings/building-c.glb', kind: 'building' },
    'bld-d': { file: 'models/buildings/building-d.glb', kind: 'building' },
    'bld-e': { file: 'models/buildings/building-e.glb', kind: 'building' },
    'bld-f': { file: 'models/buildings/building-f.glb', kind: 'building' },
    'bld-g': { file: 'models/buildings/building-g.glb', kind: 'building' },
    'bld-h': { file: 'models/buildings/building-h.glb', kind: 'building' },
    'bld-sky-a': { file: 'models/buildings/building-skyscraper-a.glb', kind: 'building' },
    'bld-sky-b': { file: 'models/buildings/building-skyscraper-b.glb', kind: 'building' },
    'bld-sky-c': { file: 'models/buildings/building-skyscraper-c.glb', kind: 'building' },
    'bld-sky-d': { file: 'models/buildings/building-skyscraper-d.glb', kind: 'building' },
    'bld-sky-e': { file: 'models/buildings/building-skyscraper-e.glb', kind: 'building' },
    'bld-house-a': { file: 'models/buildings/building-type-a.glb', kind: 'building' },
    'bld-house-b': { file: 'models/buildings/building-type-b.glb', kind: 'building' },
    'bld-house-c': { file: 'models/buildings/building-type-c.glb', kind: 'building' },
    'bld-house-d': { file: 'models/buildings/building-type-d.glb', kind: 'building' },
    'bld-house-e': { file: 'models/buildings/building-type-e.glb', kind: 'building' },
    'bld-house-f': { file: 'models/buildings/building-type-f.glb', kind: 'building' },
  };
  // Which building model a block gets, by its height class: towers for the
  // tall downtown blocks, mid-rise blocks for the rest, suburban houses for
  // the lowest ones. The pick is a hash of the block position, so the same
  // city always gets the same skyline.
  const BUILDING_VARIANTS = {
    tower: ['bld-sky-a', 'bld-sky-b', 'bld-sky-c', 'bld-sky-d', 'bld-sky-e'],
    mid: ['bld-a', 'bld-b', 'bld-c', 'bld-d', 'bld-e', 'bld-f', 'bld-g', 'bld-h'],
    low: ['bld-house-a', 'bld-house-b', 'bld-house-c', 'bld-house-d', 'bld-house-e', 'bld-house-f'],
  };
  // Game cars are 46 units long; each model is scaled so its longest side
  // matches that. Wheel radius is measured from the model, in game units.
  const modelLib = {};
  let modelsReadyResolve = null;
  let modelsSettled = false;
  const modelsReady = new Promise((resolve) => { modelsReadyResolve = resolve; });
  function loadModels() {
    if (typeof THREE.GLTFLoader !== 'function') {
      modelsReadyResolve();
      modelsSettled = true;
      return;
    }
    const loader = new THREE.GLTFLoader();
    const names = Object.keys(MODEL_FILES);
    let settled = 0;
    const settle = () => {
      settled += 1;
      if (settled === names.length) {
        modelsSettled = true;
        modelsReadyResolve();
        swapCarsToGltf();
        swapBuildingsToGltf();
        swapPeopleToGltf();
      }
    };
    for (const name of names) {
      const url = new URL(MODEL_FILES[name].file, import.meta.url).href;
      loader.load(url, (gltf) => {
        const root = gltf.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const kind = MODEL_FILES[name].kind;
        // Cars are scaled to the 46-unit game car; a person is scaled to
        // the 34-unit game person; buildings are scaled per block at swap
        // time, so they keep their raw size here.
        const scale = kind === 'person' ? PERSON_HEIGHT / size.y : 46 / Math.max(size.x, size.z);
        // Wheel pivots: every mesh whose name mentions a wheel is wrapped
        // in a pivot group, so the sync loop can spin it around its axle
        // (model X for the Kenney cars, model Y for the milk truck pair).
        // Meshes are collected first, then wrapped, so reparenting during
        // the walk cannot skip a sibling wheel.
        const wheelMeshes = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          // Building facades should catch shadows too, like the boxes
          // they replace did; cars and people only need to cast them.
          if (kind === 'building') o.receiveShadow = true;
          if (kind === 'car' && /wheel/i.test(o.name)) wheelMeshes.push(o);
        });
        const wheels = [];
        let spinAxis = 'x';
        for (const o of wheelMeshes) {
          const pivot = new THREE.Group();
          pivot.position.copy(o.position);
          pivot.rotation.copy(o.rotation);
          pivot.scale.copy(o.scale);
          o.position.set(0, 0, 0);
          o.rotation.set(0, 0, 0);
          o.scale.set(1, 1, 1);
          o.parent.add(pivot);
          pivot.add(o);
          pivot.userData.spin = 0;
          wheels.push(pivot);
          if (name === 'truck') spinAxis = 'y';
        }
        const wheelR = (name === 'truck' ? 0.43 : 0.3) * scale;
        modelLib[name] = { root, scale, size, wheels, spinAxis, wheelR, kind };
        settle();
      }, undefined, settle);
    }
  }

  // After the models arrive, drop every car mesh so the sync loop rebuilds
  // them from the GLB files on the next frame.
  function swapCarsToGltf() {
    for (const [car, grp] of carGroups) {
      scene.remove(grp);
      carGroups.delete(car);
    }
  }

  // After the building models arrive, swap each block's box body, roof
  // slab, parapet rim and (for the safehouse) pyramid for the real model,
  // stretched to the block's footprint and height. The rooftop clutter,
  // balconies, antennas, shopfronts and landmarks stay where they were:
  // they sit on the same footprint and roof height.
  function pickBuildingVariant(b, hgt) {
    const list = b.tall ? BUILDING_VARIANTS.tower : (hgt >= 60 ? BUILDING_VARIANTS.mid : BUILDING_VARIANTS.low);
    return list[Math.floor(hash01(b.x, b.y) * list.length) % list.length];
  }
  function swapBuildingsToGltf() {
    for (const rec of buildingMeshes) {
      const lib = modelLib[pickBuildingVariant(rec.b, rec.hgt)];
      if (!lib) continue;
      scene.remove(rec.body);
      scene.remove(rec.roof);
      scene.remove(rec.rim);
      if (rec.pyr) scene.remove(rec.pyr);
      const inner = lib.root.clone();
      inner.scale.set(rec.b.w / lib.size.x, rec.hgt / lib.size.y, rec.b.h / lib.size.z);
      inner.position.set(rec.b.x + rec.b.w / 2, 0, rec.b.y + rec.b.h / 2);
      scene.add(inner);
    }
    buildingMeshes.length = 0;
  }

  // A soft radial glow for the police light bar: a hard-edged coloured
  // plane reads as a floating grey slab from the chase camera, while a
  // gradient that fades to transparent reads as light.
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  function buildGltfCar(car) {
    const lib = modelLib[car._gltfVariant];
    const grp = new THREE.Group();
    const inner = lib.root.clone();
    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(lib.scale);
    grp.add(inner);
    const wheels = [];
    inner.traverse((o) => {
      if (o.userData && o.userData.spin !== undefined) {
        o.userData.baseQuat = o.quaternion.clone();
        wheels.push(o);
      }
    });
    let barRed = null;
    let barBlue = null;
    let barGlow = null;
    if (car.kind === 'police') {
      // The Kenney police car already wears a light bar; this flashing
      // overlay sits on its roof and keeps the red/blue pulse from the
      // procedural car.
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(10, 3, 22),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.4 }),
      );
      bar.position.set(-3, 20, 0);
      grp.add(bar);
      barRed = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 9),
        new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
      );
      barRed.position.set(-3, 22, -5);
      grp.add(barRed);
      barBlue = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 9),
        new THREE.MeshBasicMaterial({ color: 0x3b82ff }),
      );
      barBlue.position.set(-3, 22, 5);
      grp.add(barBlue);
      barGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 16),
        new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff3b30, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
      );
      barGlow.rotation.x = -Math.PI / 2;
      barGlow.position.set(-3, 23.5, 0);
      grp.add(barGlow);
    }
    if (car.kind === 'player') {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(56, 32),
        new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.6;
      grp.add(plate);
    }
    grp.userData = {
      wheels,
      wheelSpin: { axis: lib.spinAxis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0) },
      wheelR: lib.wheelR,
      barRed, barBlue, barGlow,
      tailMat: null,
      prevSpeed: 0,
    };
    scene.add(grp);
    carGroups.set(car, grp);
    return grp;
  }

  function buildCar(car) {
    if (!car._gltfVariant) {
      if (car.kind === 'police') {
        car._gltfVariant = 'police';
      } else {
        const variants = ['sedan', 'sedan', 'sports', 'suv', 'taxi', 'pickup', 'truck'];
        const h = Math.abs(Math.sin(car.x * 0.37 + car.y * 0.91) * 1000);
        car._gltfVariant = variants[Math.floor(h) % variants.length];
      }
    }
    if (modelLib[car._gltfVariant]) return buildGltfCar(car);
    return buildProceduralCar(car);
  }

  loadModels();

  function buildProceduralCar(car) {
    const grp = new THREE.Group();
    // Police cars read white on the road, whatever dark colour the logic
    // hands over; every other car keeps its own glossy paint.
    const paint = car.kind === 'police' ? '#f2f2f2' : car.color;
    const bodyMat = new THREE.MeshStandardMaterial({ color: hexColor(paint), roughness: 0.32, metalness: 0.55 });
    // A shaped body instead of one box: low slab, hood and trunk steps, so
    // the silhouette reads as a car from the chase camera, not a brick.
    const body = new THREE.Mesh(carBodyGeo, bodyMat);
    body.position.y = 7;
    body.castShadow = true;
    grp.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(15, 4, 22), bodyMat);
    hood.position.set(15, 12, 0);
    hood.castShadow = true;
    grp.add(hood);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(13, 4, 22), bodyMat);
    trunk.position.set(-16, 12, 0);
    trunk.castShadow = true;
    grp.add(trunk);
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, metalness: 0.3 });
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 25), skirtMat);
    skirt.position.y = 3.5;
    grp.add(skirt);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1420, roughness: 0.08, metalness: 0.9 });
    const cabin = new THREE.Mesh(carCabinGeo, glassMat);
    cabin.position.set(-3, 15, 0);
    cabin.castShadow = true;
    grp.add(cabin);
    const shieldGeo = new THREE.BoxGeometry(1.5, 7, 18);
    const shieldF = new THREE.Mesh(shieldGeo, glassMat);
    shieldF.position.set(7, 15, 0);
    shieldF.rotation.z = -0.45;
    grp.add(shieldF);
    const shieldR = new THREE.Mesh(shieldGeo, glassMat);
    shieldR.position.set(-13, 15, 0);
    shieldR.rotation.z = 0.45;
    grp.add(shieldR);
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.7 });
    for (const bx of [24, -24]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 26), chromeMat);
      bumper.position.set(bx, 5, 0);
      grp.add(bumper);
    }
    for (const mz of [-13, 13]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2), chromeMat);
      mirror.position.set(8, 14, mz);
      grp.add(mirror);
    }
    // Wheels are groups: tyre + hubcap + a spoke bar on the outer face, so
    // the spin is visible instead of a plain black cylinder turning in place.
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.75 });
    const hubGeo = new THREE.CylinderGeometry(3, 3, 5, 10);
    const spokeGeo = new THREE.BoxGeometry(1.5, 9, 1);
    const wheels = [];
    for (const [wx, wz] of [[14, 11], [14, -11], [-14, 11], [-14, -11]]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.castShadow = true;
      wheel.add(tyre);
      const side = Math.sign(wz);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = side * 1;
      wheel.add(hub);
      const spoke = new THREE.Mesh(spokeGeo, tyreMat);
      spoke.position.z = side * 2.8;
      wheel.add(spoke);
      wheel.position.set(wx, 6, wz);
      wheel.userData.spin = 0;
      grp.add(wheel);
      wheels.push(wheel);
    }
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffe9a8, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0 });
    for (const hz of [-7, 7]) {
      const hl = new THREE.Mesh(lightGeo, headMat);
      hl.position.set(23, 7, hz);
      grp.add(hl);
    }
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2a2a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0 });
    for (const tz of [-7, 7]) {
      const tl = new THREE.Mesh(lightGeo, tailMat);
      tl.position.set(-23, 7, tz);
      grp.add(tl);
    }
    // Dark wheel-arch discs behind the wheels, so the tyres sit in arches
    // instead of floating against the flat body side.
    const archGeo = new THREE.CircleGeometry(7.5, 12);
    const archMat = new THREE.MeshBasicMaterial({ color: 0x141418, side: THREE.DoubleSide });
    for (const [ax, az] of [[14, 12.2], [14, -12.2], [-14, 12.2], [-14, -12.2]]) {
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(ax, 6, az);
      arch.rotation.y = az > 0 ? 0 : Math.PI;
      grp.add(arch);
    }
    let barRed = null;
    let barBlue = null;
    let barGlow = null;
    if (car.kind === 'police') {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(10, 3, 22),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.4 }),
      );
      bar.position.set(-3, 20, 0);
      grp.add(bar);
      barRed = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 9),
        new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
      );
      barRed.position.set(-3, 22, -5);
      grp.add(barRed);
      barBlue = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 9),
        new THREE.MeshBasicMaterial({ color: 0x3b82ff }),
      );
      barBlue.position.set(-3, 22, 5);
      grp.add(barBlue);
      // A soft glow above the bar that pulses with the flashing lights.
      barGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 16),
        new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff3b30, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
      );
      barGlow.rotation.x = -Math.PI / 2;
      barGlow.position.set(-3, 23.5, 0);
      grp.add(barGlow);
    }
    if (car.kind === 'player') {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(56, 32),
        new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.6;
      grp.add(plate);
    }
    grp.userData = { wheels, barRed, barBlue, barGlow, bodyMat, tailMat, prevSpeed: 0 };
    scene.add(grp);
    carGroups.set(car, grp);
    return grp;
  }

  // People: a tapered torso, a head with eyes and hair, arms that swing
  // against the legs, and varied skin and trouser colours so no two
  // pedestrians are the same figure in a different shirt.
  const skinTones = ['#e8b98d', '#c98d5f', '#8d5f3d', '#f2c9a0', '#a06a42', '#d9a06a'];
  const hairColors = ['#1c1a18', '#4a2f1d', '#6a6a6a', '#8a5a2f', '#2f2f38', '#b8b0a0', '#c94f2f'];
  const pantsColors = ['#1c1e26', '#3a3f4a', '#4a3626', '#2c3a2e', '#5a2f3a', '#2f4a5a'];
  function buildPerson(colorCss) {
    const grp = new THREE.Group();
    const pick = Math.abs(colorCss.charCodeAt(1) * 7 + colorCss.charCodeAt(3) * 3) % 6;
    const skin = skinTones[(pick + 1) % 6];
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(8.5, 9.5, 15, 4),
      new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.85, metalness: 0 }),
    );
    torso.rotation.y = Math.PI / 4;
    torso.position.y = 14;
    torso.castShadow = true;
    grp.add(torso);
    // Broad shoulders over the tapered torso, so the figure reads as a
    // person in a shirt instead of a bell-shaped robe from behind.
    const shoulders = new THREE.Mesh(
      new THREE.BoxGeometry(15, 4, 9),
      new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.85, metalness: 0 }),
    );
    shoulders.position.y = 20;
    shoulders.castShadow = true;
    grp.add(shoulders);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(6, 12, 10),
      new THREE.MeshStandardMaterial({ color: hexColor(skin), roughness: 0.7, metalness: 0 }),
    );
    head.position.y = 27;
    head.castShadow = true;
    grp.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0 });
    for (const ez of [-2.2, 2.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 5), eyeMat);
      eye.position.set(5.4, 28.5, ez);
      grp.add(eye);
    }
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(6.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: hexColor(hairColors[pick % hairColors.length]), roughness: 0.95, metalness: 0 }),
    );
    hair.scale.set(1, 0.55, 1);
    hair.position.y = 30.5;
    grp.add(hair);
    const armMat = new THREE.MeshStandardMaterial({ color: hexColor(colorCss), roughness: 0.85, metalness: 0 });
    const armL = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), armMat);
    armL.geometry.translate(0, -6, 0);
    armL.position.set(0, 21, 4.5);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), armMat);
    armR.geometry.translate(0, -6, 0);
    armR.position.set(0, 21, -4.5);
    grp.add(armL);
    grp.add(armR);
    const legMat = new THREE.MeshStandardMaterial({ color: hexColor(pantsColors[pick]), roughness: 0.9, metalness: 0 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(5, 12, 5), legMat);
    legL.geometry.translate(0, -6, 0);
    legL.position.set(0, 12, 3.5);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(5, 12, 5), legMat);
    legR.geometry.translate(0, -6, 0);
    legR.position.set(0, 12, -3.5);
    grp.add(legL);
    grp.add(legR);
    grp.userData = { legL, legR, armL, armR };
    scene.add(grp);
    return grp;
  }
  // A real person from the vendored MakeHuman model: realistic proportions,
  // a shirt and trousers tinted per person, shoes, and a procedural hair
  // cap (the model is bald). The model has no skeleton, so it cannot swing
  // its limbs; the sync loop bobs it instead. It faces +Z in model space,
  // so it is turned to face +X like the procedural person.
  const personShirts = ['#2f6fb2', '#3a8f5a', '#c94f6d', '#7a5fc0', '#d9a03f', '#4fa8a0', '#e8e8e8', '#b8543f'];
  function buildGltfPerson(colorCss, isPlayer) {
    const lib = modelLib.person;
    const grp = new THREE.Group();
    const inner = lib.root.clone();
    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(lib.scale);
    grp.add(inner);
    const pick = Math.abs(colorCss.charCodeAt(1) * 7 + colorCss.charCodeAt(3) * 3);
    const shirtColor = isPlayer ? '#e8590c' : personShirts[pick % personShirts.length];
    const pantsColor = pantsColors[pick % pantsColors.length];
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mat = o.material;
      if (!mat || !mat.name) return;
      if (mat.name === 'Shirt') {
        o.material = mat.clone();
        o.material.color.set(shirtColor);
      } else if (mat.name === 'Pants') {
        o.material = mat.clone();
        o.material.color.set(pantsColor);
      }
    });
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 10, 8),
      new THREE.MeshStandardMaterial({ color: hexColor(hairColors[pick % hairColors.length]), roughness: 0.95, metalness: 0 }),
    );
    hair.scale.set(1, 0.55, 1);
    hair.position.y = 32.6;
    grp.add(hair);
    grp.userData = { gltf: true };
    scene.add(grp);
    return grp;
  }

  // The GLB person when it loaded, the procedural one until then (or if
  // the file failed to load).
  function buildPersonGroup(colorCss, isPlayer) {
    if (modelLib.person) return buildGltfPerson(colorCss, isPlayer);
    return buildPerson(colorCss);
  }

  // After the person model arrives, rebuild the player and every pedestrian
  // from it; the sync loop refills the pedestrian map on the next frame.
  function swapPeopleToGltf() {
    if (!modelLib.person) return;
    if (playerGroup) scene.remove(playerGroup);
    playerGroup = buildPlayerGroup();
    for (const [, grp] of pedGroups) scene.remove(grp);
    pedGroups.clear();
  }

  // The player's cap: big on the cartoon head, small on the real one.
  function addPlayerCap(grp) {
    const big = !grp.userData.gltf;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(big ? 6.5 : 2.7, big ? 6.5 : 2.7, big ? 3 : 1.4, 10),
      new THREE.MeshLambertMaterial({ color: 0x1c1e26 }),
    );
    cap.position.y = big ? 31 : 33.4;
    grp.add(cap);
  }

  let playerGroup = null;
  function buildPlayerGroup() {
    const grp = buildPersonGroup('#e8590c', true);
    addPlayerCap(grp);
    return grp;
  }
  playerGroup = buildPlayerGroup();
  const pedGroups = new Map();

  // A thin gold ring under the player on foot, so the player always reads
  // clearly in a crowd.
  const playerRing = new THREE.Mesh(
    new THREE.RingGeometry(18, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  playerRing.rotation.x = -Math.PI / 2;
  playerRing.visible = false;
  scene.add(playerRing);

  // People who are scenery, not logic: market vendors behind their stalls
  // and sunbathers lying on towels at the beach. They are built once the
  // person model has loaded (or failed), so they always match the other
  // people in the scene, and they never enter the logic's pedestrian list.
  const staticPeople = [];
  let staticPeopleBuilt = false;
  function buildStaticPeople() {
    for (const spot of vendorSpots) {
      const grp = buildPersonGroup('#3a8f5a', false);
      grp.position.set(spot.x, 0, spot.z);
      grp.rotation.y = -spot.angle;
      staticPeople.push({ grp, baseY: 0, sway: 0.4, phase: hash01(spot.x, spot.z) * 6.28 });
    }
    for (let i = 0; i < 5; i += 1) {
      const ux = beachSpot.x - 220 + i * 105 + hash01(i, 5) * 30;
      const uy = beachSpot.y + 26 + hash01(i, 9) * 46;
      const wrap = new THREE.Group();
      const fig = buildPersonGroup(personShirts[i % personShirts.length], false);
      fig.rotation.x = -Math.PI / 2;
      wrap.add(fig);
      wrap.position.set(ux, 8, uy);
      wrap.rotation.y = hash01(i, 2) * Math.PI * 2;
      scene.add(wrap);
      staticPeople.push({ grp: wrap, baseY: 8, sway: 0, phase: 0 });
    }
    // Two beachgoers standing near the water, playing catch with the ball.
    for (let i = 0; i < 2; i += 1) {
      const gx = beachSpot.x + 120 + i * 90;
      const gz = SAND_TOP + 30 + (i % 2) * 14;
      const grp = buildPersonGroup(personShirts[(i + 3) % personShirts.length], false);
      grp.position.set(gx, 0, gz);
      grp.rotation.y = -Math.PI / 2 + (i === 0 ? 0.5 : -0.5);
      staticPeople.push({ grp, baseY: 0, sway: 0.5, phase: i * 2.4 });
    }
    staticPeopleBuilt = true;
  }

  // The chase camera: behind the player on foot, further back and higher in
  // a car, pulled wider with speed. It lerps instead of snapping, and if the
  // wanted spot sits inside a building it climbs until it clears the roof.
  const camPos = new THREE.Vector3(0, 200, 0);
  let camSnapped = false;
  const desired = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function updateCamera(G, dt) {
    const driving = !!G.player.car;
    const flying = G.player.heli || G.player.plane;
    const flyAlt = flying ? flying.alt : 0;
    const speedRatio = driving ? Math.min(1, Math.abs(G.player.car.speed) / 430)
      : flying ? Math.min(1, Math.abs(flying.speed || 0) / 400) : 0;
    const heading = G.state === 'title' ? Math.PI / 2 : G.player.angle;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    focus.set(G.camera.x, 0, G.camera.y);
    // The title screen pulls right back so the skyline fills the frame
    // instead of one building wall. In a car the camera sits closer and
    // lower than the first pass, so the player's car stays fully in frame.
    // In the air it rides above and behind the aircraft instead.
    const dist = G.state === 'title' ? 300 : flying ? 200 : driving ? 130 + speedRatio * 25 : 140;
    let height = G.state === 'title' ? 190 : flying ? flyAlt + 110 : driving ? 78 + speedRatio * 12 : 85;
    desired.set(focus.x - fx * dist, height, focus.z - fz * dist);
    if (!flying && hitsBuilding(G.world, desired.x, desired.z, 0)) {
      height += 150;
      desired.y = height;
      if (hitsBuilding(G.world, desired.x, desired.z, 0)) {
        desired.set(focus.x - fx * dist * 0.55, height + 60, focus.z - fz * dist * 0.55);
      }
    }
    desired.x = Math.max(40, Math.min(WORLD_W - 40, desired.x));
    desired.z = Math.max(40, Math.min(WORLD_H - 40, desired.z));
    if (!camSnapped) {
      camPos.copy(desired);
      camSnapped = true;
    } else {
      // A stiff spring: the camera must keep up with a car at full speed,
      // or it lags hundreds of units behind and the car shrinks to a dot.
      const k = 1 - Math.exp(-8 * dt);
      camPos.lerp(desired, k);
    }
    camera.position.copy(camPos);
    if (G.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * G.shake * 0.9;
      camera.position.z += (Math.random() - 0.5) * G.shake * 0.9;
    }
    // On foot the camera looks further ahead, so the horizon drops and the
    // sea fills the frame instead of the sky. In the air it looks at the
    // aircraft's own height instead of the street.
    const lookAhead = G.state === 'title' ? 80 : flying ? 90 : driving ? 55 : 105;
    camera.lookAt(focus.x + fx * lookAhead, flying ? flyAlt + 14 : 16, focus.z + fz * lookAhead);
    sun.position.set(focus.x + 280, 420, focus.z + 180);
    sun.target.position.set(focus.x, 0, focus.z);
    sun.target.updateMatrixWorld();
  }

  function syncCars(G, dt) {
    const seen = new Set();
    for (const car of G.cars) {
      seen.add(car);
      let grp = carGroups.get(car);
      if (grp && grp.userData.kind !== car.kind) {
        scene.remove(grp);
        carGroups.delete(car);
        grp = null;
      }
      if (!grp) {
        grp = buildCar(car);
        grp.userData.kind = car.kind;
      }
      grp.position.set(car.x, 0, car.y);
      grp.rotation.y = -car.angle;
      // Rolling: the contact patch stays still while the hub moves forward,
      // so the spin angle falls at speed / wheel radius.
      for (const wheel of grp.userData.wheels) {
        wheel.userData.spin -= (car.speed * dt) / (grp.userData.wheelR || 6);
        if (grp.userData.wheelSpin) {
          // GLTF wheels spin around their axle (kept in baseQuat, so the
          // model's own tilt is preserved) instead of the procedural z.
          q.setFromAxisAngle(grp.userData.wheelSpin.axis, wheel.userData.spin);
          wheel.quaternion.copy(wheel.userData.baseQuat).multiply(q);
        } else {
          wheel.rotation.z = wheel.userData.spin;
        }
      }
      // Brake lights: flare when the car is slowing hard, glow when reversing.
      // GLTF cars wear painted taillights, so they carry no tail material.
      const braking = car.speed < grp.userData.prevSpeed - 6;
      if (grp.userData.tailMat) {
        grp.userData.tailMat.emissiveIntensity = braking ? 2.6 : car.speed < 0 ? 2.0 : 0.9;
      }
      grp.userData.prevSpeed = car.speed;
      if (grp.userData.barRed) {
        const phase = Math.floor(G.time * 4) % 2 === 0;
        grp.userData.barRed.visible = phase;
        grp.userData.barBlue.visible = !phase;
        if (grp.userData.barGlow) {
          grp.userData.barGlow.material.color.set(phase ? 0xff3b30 : 0x3b82ff);
          grp.userData.barGlow.material.opacity = 0.10 + 0.10 * Math.abs(Math.sin(G.time * 8));
        }
      }
    }
    for (const [car, grp] of carGroups) {
      if (!seen.has(car)) {
        scene.remove(grp);
        carGroups.delete(car);
      }
    }
  }

  function syncPeople(G, dt) {
    const p = G.player;
    if (p.onFoot) {
      playerGroup.visible = true;
      playerRing.visible = true;
      playerRing.position.set(p.x, 1, p.y);
      playerGroup.position.set(p.x, 0, p.y);
      if (playerGroup.userData.gltf) {
        // No skeleton to swing: bob, lean and sway with the walk instead.
        // The bob fades out when the player stands still, so the figure
        // never freezes mid-bob.
        const ud = playerGroup.userData;
        const moving = p.walkPhase !== ud.lastPhase;
        ud.move = moving ? 1 : Math.max(0, (ud.move || 0) - dt * 3);
        ud.lastPhase = p.walkPhase;
        const s = Math.sin(p.walkPhase);
        const bob = Math.abs(s) * 1.8 * ud.move;
        playerGroup.position.y = bob;
        playerGroup.rotation.set(s * 0.05 + 0.03, -p.angle + s * 0.03 * ud.move, s * 0.05 * ud.move);
      } else {
        const swing = Math.sin(p.walkPhase) * 0.5;
        playerGroup.rotation.y = -p.angle;
        playerGroup.userData.legL.rotation.x = swing;
        playerGroup.userData.legR.rotation.x = -swing;
        playerGroup.userData.armL.rotation.x = -swing;
        playerGroup.userData.armR.rotation.x = swing;
      }
    } else {
      playerGroup.visible = false;
      playerRing.visible = false;
    }
    const seen = new Set();
    for (const ped of G.peds) {
      seen.add(ped);
      let grp = pedGroups.get(ped);
      if (!grp) {
        grp = buildPersonGroup(ped.color, false);
        pedGroups.set(ped, grp);
      }
      grp.position.set(ped.x, 0, ped.y);
      if (ped.state === 'down') {
        grp.rotation.set(0, -ped.angle, Math.PI / 2);
        grp.position.y = 4;
      } else if (grp.userData.gltf) {
        if (ped.state === 'chat') {
          // Standing and talking: barely a breath, no walk bob.
          grp.position.y = Math.sin(G.time * 1.5 + ped.x) * 0.3;
          grp.rotation.set(0.01, -ped.angle, 0);
        } else {
          // A real walk cycle: the phase advances with the ped's own
          // speed, so fast walkers step faster than slow ones, and the
          // body bobs, leans and sways with each step.
          const ud = grp.userData;
          ud.phase = (ud.phase || 0) + dt * ped.speed * 0.085;
          const s = Math.sin(ud.phase);
          grp.position.y = Math.abs(s) * 1.6;
          grp.rotation.set(s * 0.05 + 0.03, -ped.angle + s * 0.04, s * 0.05);
        }
      } else {
        grp.rotation.set(0, -ped.angle, 0);
        const swing = Math.sin(G.time * 9 + ped.x) * 0.4;
        grp.userData.legL.rotation.x = swing;
        grp.userData.legR.rotation.x = -swing;
        grp.userData.armL.rotation.x = -swing;
        grp.userData.armR.rotation.x = swing;
      }
    }
    for (const [ped, grp] of pedGroups) {
      if (!seen.has(ped)) {
        scene.remove(grp);
        pedGroups.delete(ped);
      }
    }
  }

  function updateGps(G) {
    const target = G.missionTarget;
    if (!target) {
      for (const m of gpsMarkers) m.visible = false;
      beaconRing.visible = false;
      beaconBeam.visible = false;
      return;
    }
    const rp = nearestRoadPoint(G.player.x, G.player.y);
    const rt = nearestRoadPoint(target.x, target.y);
    const pts = [
      [G.player.x, G.player.y],
      [rp.roadX, G.player.y],
      [rp.roadX, rt.roadY],
      [rt.roadX, rt.roadY],
      [target.x, target.y],
    ];
    let mi = 0;
    for (let s = 0; s < pts.length - 1 && mi < GPS_N; s += 1) {
      const [x0, z0] = pts[s];
      const [x1, z1] = pts[s + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.floor(len / 36));
      for (let i = 0; i < steps && mi < GPS_N; i += 1) {
        const t = i / steps;
        const m = gpsMarkers[mi];
        m.position.set(x0 + (x1 - x0) * t, 1.2, z0 + (z1 - z0) * t);
        m.material.opacity = 0.55 + 0.35 * Math.sin(G.time * 4 + mi * 0.4);
        m.visible = true;
        mi += 1;
      }
    }
    for (; mi < GPS_N; mi += 1) gpsMarkers[mi].visible = false;
    const pulse = 1 + Math.sin(G.time * 5) * 0.15;
    beaconRing.visible = true;
    beaconRing.position.set(target.x, 1, target.y);
    beaconRing.scale.set(pulse, pulse, 1);
    beaconBeam.visible = true;
    beaconBeam.position.set(target.x, 75, target.y);
  }

  // A slow weather cycle: clear -> partly cloudy -> warm haze -> clear over
  // about two and a half minutes, shifting the light, fog and cloud cover a
  // little. Visibility and frame rate never suffer: even the hazy state only
  // pulls the fog in to 480/1750.
  const weatherKeys = [
    { t: 0.00, sun: 1.6, sunColor: 0xffd9a0, hemi: 1.2, fogNear: 700, fogFar: 2400, fogColor: 0xcfe4ef, cloud: 1.0, sky: 0xffffff },
    { t: 0.35, sun: 1.35, sunColor: 0xffe2b8, hemi: 1.05, fogNear: 650, fogFar: 2200, fogColor: 0xd8e6ef, cloud: 1.25, sky: 0xf2f5f8 },
    { t: 0.60, sun: 1.5, sunColor: 0xffc98a, hemi: 1.1, fogNear: 480, fogFar: 1750, fogColor: 0xf2ddb8, cloud: 0.7, sky: 0xffe8c4 },
    { t: 0.85, sun: 1.6, sunColor: 0xffd9a0, hemi: 1.2, fogNear: 700, fogFar: 2400, fogColor: 0xcfe4ef, cloud: 1.0, sky: 0xffffff },
    { t: 1.00, sun: 1.6, sunColor: 0xffd9a0, hemi: 1.2, fogNear: 700, fogFar: 2400, fogColor: 0xcfe4ef, cloud: 1.0, sky: 0xffffff },
  ];
  const weatherTmpA = new THREE.Color();
  const weatherTmpB = new THREE.Color();
  // Day and night: one full cycle takes DAY_LENGTH seconds of play — a long
  // afternoon, a short dusk, a night, then dawn. nightFactor (0 by day,
  // ~0.9 at deep night) is shared with the neon and lamp updates below.
  let nightFactor = 0;
  const dayKeys = [
    { t: 0.00, sun: 1.0, sunColor: 0xffd9a0, hemi: 1.0, sky: 0xffffff, fog: 0xcfe4ef },
    { t: 0.42, sun: 0.55, sunColor: 0xff9a50, hemi: 0.8, sky: 0xffc890, fog: 0xe8c8a8 },
    { t: 0.55, sun: 0.10, sunColor: 0x8aa8d8, hemi: 0.15, sky: 0x0d1626, fog: 0x0a0f1e },
    { t: 0.78, sun: 0.10, sunColor: 0x8aa8d8, hemi: 0.15, sky: 0x0d1626, fog: 0x0a0f1e },
    { t: 0.88, sun: 0.7, sunColor: 0xffb0a0, hemi: 0.8, sky: 0xf2c4b8, fog: 0xe8c4c0 },
    { t: 1.00, sun: 1.0, sunColor: 0xffd9a0, hemi: 1.0, sky: 0xffffff, fog: 0xcfe4ef },
  ];
  function updateWeather(G) {
    const phase = (G.time / 150) % 1;
    let i = 0;
    while (i < weatherKeys.length - 2 && phase >= weatherKeys[i + 1].t) i += 1;
    const a = weatherKeys[i];
    const b = weatherKeys[i + 1];
    const raw = (phase - a.t) / (b.t - a.t);
    const s = raw * raw * (3 - 2 * raw);
    sun.intensity = a.sun + (b.sun - a.sun) * s;
    sun.color.setHex(a.sunColor).lerp(weatherTmpA.setHex(b.sunColor), s);
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * s;
    scene.fog.near = a.fogNear + (b.fogNear - a.fogNear) * s;
    scene.fog.far = a.fogFar + (b.fogFar - a.fogFar) * s;
    scene.fog.color.setHex(a.fogColor).lerp(weatherTmpB.setHex(b.fogColor), s);
    skyDome.material.color.setHex(a.sky).lerp(weatherTmpA.setHex(b.sky), s);
    for (const c of clouds) c.spr.material.opacity = Math.min(0.98, c.base * (a.cloud + (b.cloud - a.cloud) * s));
    // Day and night on top of the weather: the sun dims and cools toward
    // moonlight, the sky and fog go dark blue, the sun sets and the moon
    // rises, and the street lamps come on. Screenshots are taken seconds
    // after load (G.time near 0), so they always land in bright daylight.
    const dPhase = (G.time / DAY_LENGTH) % 1;
    let j = 0;
    while (j < dayKeys.length - 2 && dPhase >= dayKeys[j + 1].t) j += 1;
    const da = dayKeys[j];
    const db = dayKeys[j + 1];
    const dRaw = (dPhase - da.t) / (db.t - da.t);
    const ds = dRaw * dRaw * (3 - 2 * dRaw);
    const dSun = da.sun + (db.sun - da.sun) * ds;
    nightFactor = 1 - dSun;
    sun.intensity *= dSun;
    sun.color.lerp(weatherTmpA.setHex(da.sunColor).lerp(weatherTmpB.setHex(db.sunColor), ds), nightFactor * 0.85);
    // Hemisphere light dims hard at night (the old 0.35 floor left the
    // city looking like a cloudy afternoon); the lamps and neon below
    // carry the night look instead.
    hemi.intensity *= da.hemi + (db.hemi - da.hemi) * ds;
    skyDome.material.color.lerp(weatherTmpA.setHex(da.sky).lerp(weatherTmpB.setHex(db.sky), ds), nightFactor);
    scene.fog.color.lerp(weatherTmpA.setHex(da.fog).lerp(weatherTmpB.setHex(db.fog), ds), nightFactor);
    // Clouds fade with the light so they do not hang bright white over a
    // dark city.
    for (const c of clouds) c.spr.material.opacity *= 1 - nightFactor * 0.75;
    const sunVis = nightFactor < 0.85;
    sunDisc.visible = sunVis;
    sunGlow.visible = sunVis;
    sunHalo.visible = sunVis;
    sunDisc.material.opacity = 0.98 * (1 - nightFactor);
    sunGlow.material.opacity = 0.45 * (1 - nightFactor);
    sunHalo.material.opacity = 0.16 * (1 - nightFactor);
    moonDisc.visible = nightFactor > 0.4;
    moonGlow.visible = nightFactor > 0.4;
    // The moon rides near the camera focus, low in the north-west sky,
    // so it can actually be seen from street level at night.
    moonDisc.position.set(focus.x - 1600, 600, focus.z - 1200);
    moonGlow.position.copy(moonDisc.position);
    moonDisc.material.opacity = Math.max(0, nightFactor - 0.4) * 1.4;
    moonGlow.material.opacity = Math.max(0, nightFactor - 0.4) * 0.5;
    lampHeadMat.emissiveIntensity = 0.9 + nightFactor * 1.6;
    // Shared with the game logic: the police helicopter's searchlight only
    // comes on once the night is properly dark.
    G.nightFactor = nightFactor;
  }

  // Aircraft: the flyable helicopter and plane, the police helicopter, the
  // airliners overhead, and the weapon crates. Every group is repositioned
  // from the logic state in G; spin and blink state lives in userData.
  function syncAircraft(G, dt) {
    const fh = G.flyHeli;
    if (fh) {
      flyHeliGroup.visible = true;
      flyHeliGroup.position.set(fh.x, fh.alt, fh.y);
      const pitch = Math.max(-0.14, Math.min(0.14, (fh.speed / 320) * 0.14));
      flyHeliGroup.rotation.set(0, -fh.angle, -pitch);
      flyHeliGroup.userData.rotorSpin += dt * (fh.landed ? 4 : 28);
      flyHeliGroup.userData.rotor.rotation.y = flyHeliGroup.userData.rotorSpin;
      flyHeliGroup.userData.tailRotor.rotation.x = flyHeliGroup.userData.rotorSpin * 2.2;
    } else {
      flyHeliGroup.visible = false;
    }
    const ph = G.policeHeli;
    if (ph) {
      policeHeliGroup.visible = true;
      policeHeliGroup.position.set(ph.x, ph.alt, ph.y);
      policeHeliGroup.rotation.set(0, -ph.angle, 0.06);
      policeHeliGroup.userData.rotorSpin += dt * 30;
      policeHeliGroup.userData.rotor.rotation.y = policeHeliGroup.userData.rotorSpin;
      policeHeliGroup.userData.tailRotor.rotation.x = policeHeliGroup.userData.rotorSpin * 2.2;
      const phase = Math.floor(G.time * 4) % 2 === 0;
      policeHeliGroup.userData.barRed.visible = phase;
      policeHeliGroup.userData.barBlue.visible = !phase;
      const night = (G.nightFactor || 0) > 0.4;
      searchCone.visible = night;
      searchSpot.visible = night;
      if (night) {
        searchCone.scale.y = ph.alt / 260;
        searchCone.position.set(ph.x, ph.alt / 2, ph.y);
        searchSpot.position.set(ph.x, 1.2, ph.y);
      }
    } else {
      policeHeliGroup.visible = false;
      searchCone.visible = false;
      searchSpot.visible = false;
    }
    const fp = G.flyPlane;
    if (fp) {
      flyPlaneGroup.visible = true;
      flyPlaneGroup.position.set(fp.x, fp.alt, fp.y);
      const climbPitch = Math.max(-0.25, Math.min(0.25, (fp.vSpeed / 120) * 0.25));
      flyPlaneGroup.rotation.set(fp.bank || 0, -fp.angle, climbPitch);
      flyPlaneGroup.userData.propSpin += dt * (fp.airborne || fp.speed > 10 ? 40 : 2);
      flyPlaneGroup.userData.prop.rotation.x = flyPlaneGroup.userData.propSpin;
      const blink = Math.floor(G.time * 2) % 2 === 0;
      flyPlaneGroup.userData.navRed.visible = blink;
      flyPlaneGroup.userData.navGreen.visible = !blink;
    } else {
      flyPlaneGroup.visible = false;
    }
    for (let i = 0; i < ambientPlaneGroups.length; i += 1) {
      const ap = G.planes[i];
      const grp = ambientPlaneGroups[i];
      if (!ap) {
        grp.visible = false;
        continue;
      }
      grp.visible = true;
      grp.position.set(ap.x, ap.alt, ap.y);
      grp.rotation.set(0, -ap.angle, 0.05);
      grp.userData.propSpin += dt * 25;
      grp.userData.prop.rotation.x = grp.userData.propSpin;
      const blink = Math.floor(G.time * 2 + i) % 2 === 0;
      grp.userData.navRed.visible = blink;
      grp.userData.navGreen.visible = !blink;
    }
    const seen = new Set();
    for (const pickup of G.weaponPickups) {
      seen.add(pickup);
      let grp = weaponPickupGroups.get(pickup);
      if (!grp) {
        grp = buildWeaponPickupMesh(pickup.kind);
        weaponPickupGroups.set(pickup, grp);
        scene.add(grp);
      }
      grp.visible = !pickup.taken;
      if (grp.visible) {
        grp.position.set(pickup.x, 4 + Math.sin(G.time * 3 + pickup.x) * 2, pickup.y);
        grp.rotation.y = G.time * 0.8;
      }
    }
    for (const [pickup, grp] of weaponPickupGroups) {
      if (!seen.has(pickup)) {
        scene.remove(grp);
        weaponPickupGroups.delete(pickup);
      }
    }
  }

  function update(G, dt) {
    updateCamera(G, dt);
    syncCars(G, dt);
    syncPeople(G, dt);
    syncAircraft(G, dt);
    for (const p of world.pickups) {
      const grp = pickupGroups.get(p);
      grp.visible = !p.taken;
      if (grp.visible) {
        grp.position.y = 4 + Math.sin(G.time * 3 + p.x) * 2;
        grp.rotation.y = G.time * 0.8;
      }
    }
    G.bullets.forEach((b, i) => {
      if (i >= bulletPool.length) return;
      const m = bulletPool[i];
      m.visible = true;
      m.position.set(b.x, 12, b.y);
      m.rotation.y = -b.angle;
      m.scale.setScalar(b.big ? 2.6 : 1);
    });
    for (let i = G.bullets.length; i < bulletPool.length; i += 1) bulletPool[i].visible = false;
    G.particles.forEach((pt, i) => {
      if (i >= particlePool.length) return;
      const m = particlePool[i];
      m.visible = true;
      m.position.set(pt.x, 6, pt.y);
      m.scale.setScalar(Math.max(0.5, pt.size / 2));
      m.material.color.set(pt.color);
    });
    for (let i = G.particles.length; i < particlePool.length; i += 1) particlePool[i].visible = false;
    G.skid.forEach((s, i) => {
      if (i >= skidPool.length) return;
      const m = skidPool[i];
      m.visible = true;
      m.position.set(s.x, 0.4, s.y);
      m.rotation.set(-Math.PI / 2, 0, s.angle);
      m.material.opacity = Math.max(0, s.life / 6) * 0.5;
    });
    for (let i = G.skid.length; i < skidPool.length; i += 1) skidPool[i].visible = false;
    // The sea shader runs its own waves, glitter and foam from the clock,
    // and its fog uniforms follow the scene fog the weather cycle moves.
    seaUniforms.uTime.value = G.time;
    seaUniforms.uNight.value = nightFactor;
    seaUniforms.uFogColor.value.copy(scene.fog.color);
    seaUniforms.uFogNear.value = scene.fog.near;
    seaUniforms.uFogFar.value = scene.fog.far;
    // Clouds drift at their own speeds and wrap around the world.
    for (const c of clouds) {
      c.spr.position.x += c.speed * dt;
      if (c.spr.position.x > WORLD_W + 1400) c.spr.position.x = -500;
    }
    updateWeather(G);
    updateGps(G);
    updateTrafficLights(G);
    // Ambient life: palms sway, flags wave, birds cross the sky, smoke
    // rises, neon flickers, and the static people breathe a little.
    for (const f of palmFronds) {
      f.mesh.rotation.x = f.rx + Math.sin(G.time * 0.9 + f.phase) * 0.07;
      f.mesh.rotation.z = f.rz + Math.cos(G.time * 0.7 + f.phase) * 0.06;
    }
    for (const fl of flags) {
      fl.mesh.rotation.y = Math.sin(G.time * 2.2 + fl.phase) * 0.45;
      fl.mesh.scale.x = 1 + Math.sin(G.time * 3.3 + fl.phase) * 0.12;
    }
    for (const b of birds) {
      b.grp.position.x += b.speed * dt;
      if (b.grp.position.x > WORLD_W + 320) b.grp.position.x = -320;
      const flap = Math.sin(G.time * 9 + b.phase) * 0.55;
      b.wingL.rotation.x = flap;
      b.wingR.rotation.x = -flap;
    }
    if (chimneys.length > 0) {
      for (const sp of smokePuffs) {
        sp.age += dt;
        if (sp.age > sp.dur) sp.age = 0;
        const t = sp.age / sp.dur;
        sp.mesh.visible = true;
        sp.mesh.position.set(sp.chimney.x + Math.sin(sp.age * 1.5) * 4, sp.chimney.y + sp.age * 11, sp.chimney.z);
        sp.mesh.scale.setScalar(4 + sp.age * 2.2);
        sp.mat.opacity = 0.3 * (1 - t);
      }
    }
    for (const n of neonSigns) {
      let intensity = 0.85 + 0.15 * Math.sin(G.time * 2 + n.phase);
      if (Math.sin(G.time * 9.7 + n.phase * 3) < -0.92) intensity = 0.15;
      // Neon reads twice as bright once the sun is down.
      n.mat.emissiveIntensity = intensity * (1 + nightFactor * 0.9);
    }
    if (!staticPeopleBuilt && modelsSettled) buildStaticPeople();
    for (const sp of staticPeople) {
      if (sp.sway > 0) {
        sp.grp.rotation.z = Math.sin(G.time * 1.2 + sp.phase) * 0.02;
        sp.grp.position.y = sp.baseY + Math.sin(G.time * 1.2 + sp.phase) * 0.3;
      }
    }
    beachBall.position.y = 7 + Math.sin(G.time * 2) * 1.5;
    beachBall.rotation.y = G.time * 0.4;
  }

  function groundPoint(mx, my, w, h) {
    camera.updateMatrixWorld();
    ndc.set((mx / w) * 2 - 1, -(my / h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    if (d.y > -0.0001) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    update,
    render() {
      renderer.render(scene, camera);
    },
    resize,
    groundPoint,
    camera,
    modelsReady,
  };
}
