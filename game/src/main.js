// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. The game moves
// between title, play, paused, busted and wasted. Wanted stars rise with
// crime and fall when the player stays quiet and out of sight.
//
// ?seed=N fixes the city layout. ?shot=start|drive|foot|chase (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import {
  TILE, WORLD_W, WORLD_H, SAVE_KEY, MAX_WANTED,
  CRIME_QUIET_SECONDS, WANTED_DECAY_SECONDS,
} from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { createPlayer, updatePlayer, updatePickups } from './player.js';
import {
  spawnParkedCars, spawnTraffic, spawnPoliceCar, spawnRoadblock, spawnPeds,
  updateCars, updatePeds, updateBullets, drivePlayerCar,
} from './cars.js';
import { createMissions, updateMissions, missionInfo } from './missions.js';
import { createWeaponPickups, updateWeaponPickups } from './weapons.js';
import {
  createFlyHeli, createFlyPlane, createAmbientPlanes,
  updatePoliceHeli, updateAmbientPlanes, driveHeli, drivePlane, spawnPoliceHeli,
} from './aircraft.js';
import { createRenderer3D } from './render3d.js';
import { drawHUD, drawTitle, drawPaused, drawEnd, titleButtons, pauseButtons } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');

const rng = createRandom(seed);
const world = createWorld(rng);
const renderer3D = createRenderer3D(canvas, world);

const G = {
  time: 0,
  rng,
  world,
  player: createPlayer(world.places.hospital.x, world.places.hospital.y),
  missions: createMissions(),
  cars: [],
  peds: [],
  bullets: [],
  particles: [],
  skid: [],
  weaponPickups: createWeaponPickups(),
  flyHeli: createFlyHeli(),
  flyPlane: createFlyPlane(),
  planes: createAmbientPlanes(),
  policeHeli: null,
  nightFactor: 0,
  feed: ['Welcome to Solmar. Steal a car — press E near one.'],
  banner: null,
  wanted: 0,
  crimeT: 99,
  decayT: 0,
  policeSpawnT: 0,
  roadblockT: 6,
  camera: { x: world.places.hospital.x, y: world.places.hospital.y, zoom: 1 },
  shake: 0,
  state: 'title',
  hasSave: false,
  missionTarget: null,
  audio: createAudio(),
  spawnPoliceCar,
};

G.addWanted = function (n) {
  G.wanted = Math.min(MAX_WANTED, G.wanted + n);
  G.crimeT = 0;
  G.decayT = 0;
};

G.busted = function (reason) {
  if (G.state !== 'playing') return;
  const fine = Math.min(200, G.player.money);
  G.player.money -= fine;
  G.endReason = `${reason} Fine: $${fine}.`;
  G.state = 'busted';
  G.audio.busted();
  G.audio.engine(0, false);
  G.audio.siren(false, 0);
  G.save();
};

G.wasted = function (reason) {
  if (G.state !== 'playing') return;
  const fine = Math.min(100, G.player.money);
  G.player.money -= fine;
  G.endReason = `${reason} Hospital bill: $${fine}.`;
  G.state = 'wasted';
  G.audio.busted();
  G.audio.engine(0, false);
  G.audio.siren(false, 0);
  G.save();
};

G.save = function () {
  try {
    const data = {
      money: G.player.money,
      missionIndex: G.missions.index,
      missionStage: G.missions.stage,
      x: G.player.x,
      y: G.player.y,
      hp: G.player.hp,
      weapon: G.player.weapons.weapon,
      ammo: G.player.weapons.ammo,
      owned: G.player.weapons.owned,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    G.hasSave = true;
  } catch {
    // Storage can be off: the save then lasts this visit only.
  }
};

G.load = function () {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    G.player.money = data.money ?? 250;
    G.player.hp = data.hp ?? 100;
    if (data.weapon) G.player.weapons.weapon = data.weapon;
    if (data.ammo) G.player.weapons.ammo = { ...G.player.weapons.ammo, ...data.ammo };
    if (data.owned) G.player.weapons.owned = { ...G.player.weapons.owned, ...data.owned };
    G.player.x = data.x ?? world.places.hospital.x;
    G.player.y = data.y ?? world.places.hospital.y;
    G.missions.index = data.missionIndex ?? 0;
    G.missions.stage = data.missionStage ?? 'steal';
    G.missions.timer = 0;
    G.missions.started = false;
    return true;
  } catch {
    return false;
  }
};

try {
  G.hasSave = !!window.localStorage.getItem(SAVE_KEY);
} catch {
  G.hasSave = false;
}

spawnParkedCars(G);
spawnTraffic(G, 22);
spawnPeds(G, 40);

function policeCount() {
  return G.cars.filter((c) => c.kind === 'police').length;
}

function updateWanted(dt) {
  G.crimeT += dt;
  G.policeSpawnT -= dt;
  G.roadblockT -= dt;
  // The heat calls in more cars until the count matches the stars.
  if (G.wanted > 0 && policeCount() < G.wanted && G.policeSpawnT <= 0) {
    G.policeSpawnT = 1.5;
    spawnPoliceCar(G);
  }
  // At four stars and up the chopper comes out: it circles overhead and
  // watches, so the player cannot shake the heat while it is up there.
  // (It leaves on its own once the heat is fully gone.)
  if (G.wanted >= 4 && !G.policeHeli) spawnPoliceHeli(G);
  // At 4-5 stars the police seal a road ahead of the player: two cars
  // across the next intersection in the player's path. One block at a
  // time, on a long cooldown, so the player can always ram through or
  // turn off — and a fresh block never appears during a screenshot's
  // 1.5 s play-forward (the trigger waits 6 s after the heat starts).
  if (G.wanted >= 4 && G.roadblockT <= 0 && !G.cars.some((c) => c.roadblock)) {
    const heading = G.player.car ? G.player.car.angle : G.player.angle;
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    let best = null;
    let bestD = Infinity;
    for (const n of G.world.intersections) {
      const dx = n.x - G.player.x;
      const dy = n.y - G.player.y;
      const d = Math.hypot(dx, dy);
      const ahead = dx * fx + dy * fy;
      if (ahead > 200 && d > 300 && d < 900 && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best) {
      spawnRoadblock(G, best.x, best.y, heading);
      G.roadblockT = 25;
    } else {
      G.roadblockT = 8;
    }
  }
  // Quiet and unseen for a while: the heat dies down one star at a time.
  // Not while the helicopter watches — from the air there is no hiding.
  if (G.wanted > 0 && G.crimeT > CRIME_QUIET_SECONDS && !G.policeHeli) {
    const near = G.cars.some((c) => c.kind === 'police' && Math.hypot(c.x - G.player.x, c.y - G.player.y) < 500);
    if (!near) {
      G.decayT += dt;
      if (G.decayT > WANTED_DECAY_SECONDS) {
        G.decayT = 0;
        G.wanted -= 1;
        if (G.wanted === 0) {
          G.cars = G.cars.filter((c) => c.kind !== 'police');
          G.feed.push('You lost the cops!');
        }
      }
    } else {
      G.decayT = 0;
    }
  }
}

function updateCamera(dt) {
  // The chase camera focuses on the player, or drifts slowly down the long
  // middle avenue toward the sea on the title screen, so the menu opens on
  // a street, buildings and the coast instead of one building's roof.
  const focusX = G.state === 'title' ? 19 * TILE + 48 + Math.sin(G.time * 0.05) * 100 : G.player.x;
  const focusY = G.state === 'title' ? 26 * TILE : G.player.y;
  const cam = G.camera;
  cam.x += (focusX - cam.x) * Math.min(1, 5 * dt);
  cam.y += (focusY - cam.y) * Math.min(1, 5 * dt);
  renderer3D.update(G, dt);
}

function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i -= 1) {
    const pt = G.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) G.particles.splice(i, 1);
  }
  for (let i = G.skid.length - 1; i >= 0; i -= 1) {
    G.skid[i].life -= dt;
    if (G.skid[i].life <= 0) G.skid.splice(i, 1);
  }
  G.shake = Math.max(0, G.shake - dt * 26);
  if (G.banner) {
    G.banner.t -= dt;
    if (G.banner.t <= 0) G.banner = null;
  }
  if (G.feed.length > 8) G.feed.splice(0, G.feed.length - 8);
}

function update(dt, input) {
  G.time += dt;
  G.missionTarget = missionInfo(G).target || null;
  if (G.state === 'title') {
    // The title screen plays over a living city: traffic and pedestrians move.
    updateCars(G, dt);
    updatePeds(G, dt);
    updateCamera(dt);
    return;
  }
  if (G.state !== 'playing') return;
  // Where the mouse points on the ground, through the 3D camera: the pistol
  // fires toward that spot. Falls back to the facing direction if the ray
  // misses the ground plane.
  G.aim = renderer3D.groundPoint(input.mouse.x, input.mouse.y, G.viewW || window.innerWidth, G.viewH || window.innerHeight);
  updatePlayer(G, input, dt);
  if (G.state !== 'playing') return;
  if (G.player.car) drivePlayerCar(G, input, dt);
  else if (G.player.heli) driveHeli(G, input, dt);
  else if (G.player.plane) drivePlane(G, input, dt);
  updateCars(G, dt);
  updatePeds(G, dt);
  updateBullets(G, dt);
  updateMissions(G, dt);
  updatePickups(G, dt);
  updateWeaponPickups(G, dt);
  updatePoliceHeli(G, dt);
  updateAmbientPlanes(G, dt);
  updateWanted(dt);
  updateParticles(dt);
  updateCamera(dt);
  const driving = !!(G.player.car || G.player.heli || G.player.plane);
  const vehicle = G.player.car || G.player.heli || G.player.plane;
  const speedRatio = driving ? Math.min(1, Math.abs(vehicle.speed || 0) / 430) : 0;
  G.audio.engine(speedRatio, driving);
  G.audio.siren(G.wanted >= 2 && policeCount() > 0, dt);
}

function resize() {
  const ratio = window.devicePixelRatio || 1;
  for (const c of [canvas, hudCanvas]) {
    c.width = Math.round(window.innerWidth * ratio);
    c.height = Math.round(window.innerHeight * ratio);
    c.style.width = `${window.innerWidth}px`;
    c.style.height = `${window.innerHeight}px`;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  renderer3D.resize(window.innerWidth, window.innerHeight);
  G.viewW = window.innerWidth;
  G.viewH = window.innerHeight;
}

function render() {
  const w = G.viewW || window.innerWidth;
  const h = G.viewH || window.innerHeight;
  renderer3D.render();
  // The HUD canvas is transparent: clear it, never fill it, so the 3D view
  // shows through everywhere the HUD does not draw.
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (G.state === 'title') drawTitle(ctx, G, w, h);
  else if (G.state === 'paused') {
    drawHUD(ctx, G, w, h);
    drawPaused(ctx, G, w, h);
  } else if (G.state === 'busted' || G.state === 'wasted') {
    drawHUD(ctx, G, w, h);
    drawEnd(ctx, G, w, h, G.state, G.endReason);
  } else {
    drawHUD(ctx, G, w, h);
  }
}

function startGame(fresh) {
  if (fresh) {
    G.player = createPlayer(world.places.hospital.x, world.places.hospital.y);
    G.missions = createMissions();
    G.wanted = 0;
    G.crimeT = 99;
    G.cars = G.cars.filter((c) => c.kind !== 'police');
    G.policeHeli = null;
    G.flyHeli = createFlyHeli();
    G.flyPlane = createFlyPlane();
    G.weaponPickups = createWeaponPickups();
    G.feed = ['Welcome to Solmar. Steal a car — press E near one.'];
  }
  G.state = 'playing';
  G.audio.resume();
  G.audio.radioStart();
  status.textContent = 'Playing. WASD to move, E to enter a car.';
}

function respawn() {
  const p = G.player;
  if (p.car) {
    const idx = G.cars.indexOf(p.car);
    if (idx >= 0) G.cars.splice(idx, 1);
    p.car = null;
  }
  // A wrecked helicopter or plane is back on its parking spot by morning.
  p.heli = null;
  p.plane = null;
  G.flyHeli = createFlyHeli();
  G.flyPlane = createFlyPlane();
  G.policeHeli = null;
  p.onFoot = true;
  p.x = world.places.hospital.x;
  p.y = world.places.hospital.y;
  p.hp = 100;
  p.bustedT = 0;
  G.wanted = 0;
  G.cars = G.cars.filter((c) => c.kind !== 'police');
  G.state = 'playing';
  G.feed.push('You woke up at Solmar General. Try not to get caught.');
}

function inRect(mx, my, rect) {
  return mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
}

function runShot(name) {
  resize();
  stageShot(G, name);
  // Play the scene forward for 1.5 seconds with a driver holding W, so the
  // cars really move, the police really chase and the camera really follows —
  // the frame is a real moment of play, not a posed still.
  const driving = name === 'drive' || name === 'chase';
  const fakeInput = {
    down: (code) => driving && (code === 'KeyW' || code === 'ArrowUp'),
    pressed: () => false,
    clickedLeft: () => false,
    clickedRight: () => false,
    mouse: { x: (G.viewW || 1280) / 2, y: (G.viewH || 720) / 2 },
    endFrame: () => {},
  };
  for (let i = 0; i < 90; i += 1) update(STEP, fakeInput);
  let painted = 0;
  function paint() {
    render();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let accumulator = 0;
  let last = performance.now();

  function handleActions() {
    if (input.pressed('KeyM')) {
      G.audio.setMuted(!G.audio.isMuted());
      G.feed.push(G.audio.isMuted() ? 'Sound off.' : 'Sound on.');
    }
    if (G.state === 'title') {
      if (input.pressed('Enter')) {
        startGame(true);
        return;
      }
      if (input.clickedLeft()) {
        const w = G.viewW || window.innerWidth;
        const h = G.viewH || window.innerHeight;
        for (const b of titleButtons(w, h, G.hasSave)) {
          if (inRect(input.mouse.x, input.mouse.y, b)) {
            if (b.id === 'start') startGame(true);
            else if (b.id === 'continue') {
              G.load();
              startGame(false);
            } else if (b.id === 'mute') G.audio.setMuted(!G.audio.isMuted());
            return;
          }
        }
      }
      return;
    }
    if (G.state === 'playing') {
      if (input.pressed('Escape') || input.pressed('KeyP')) {
        G.state = 'paused';
        status.textContent = 'Paused.';
      }
      if (input.pressed('KeyR')) {
        const name = G.audio.radioNext();
        if (name) G.feed.push(`Radio: ${name}`);
      }
      return;
    }
    if (G.state === 'paused') {
      if (input.pressed('Escape') || input.pressed('KeyP')) {
        G.state = 'playing';
        return;
      }
      if (input.clickedLeft()) {
        const w = G.viewW || window.innerWidth;
        const h = G.viewH || window.innerHeight;
        for (const b of pauseButtons(w, h)) {
          if (inRect(input.mouse.x, input.mouse.y, b)) {
            if (b.id === 'resume') G.state = 'playing';
            else if (b.id === 'restart') startGame(true);
            else if (b.id === 'mute') G.audio.setMuted(!G.audio.isMuted());
            else if (b.id === 'quit') {
              G.save();
              G.state = 'title';
            }
            return;
          }
        }
      }
      return;
    }
    if (G.state === 'busted' || G.state === 'wasted') {
      if (input.pressed('Enter') || input.clickedLeft()) respawn();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    while (accumulator >= STEP && G.state !== 'paused') {
      update(STEP, input);
      accumulator -= STEP;
      if (G.state === 'paused') break;
    }
    if (G.state === 'paused') accumulator = 0;
    input.endFrame();
    render();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') G.state = 'paused';
  });

  resize();
  window.addEventListener('resize', resize);
  status.textContent = 'SOLMAR. Press Enter or click START.';
  requestAnimationFrame(frame);
}

window.__game = G;

if (shot) {
  // Shots are real moments of play: wait for the GLB models (or their
  // failure) so the frame shows the same cars the player sees, not the
  // procedural stand-ins. The 10 s cap keeps a stuck load from hanging
  // the screenshot run.
  Promise.race([
    renderer3D.modelsReady,
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]).then(() => runShot(shot));
} else runGame();
