// SOLMAR's skies: a flyable helicopter on a beach helipad, a police
// helicopter that circles the player at four and five stars, airliners
// crossing overhead, and a small plane on the beach strip that the player
// can take off in. Everything here is original — no borrowed vehicles.
import { WORLD_W, WORLD_H, SAND_TOP, SEA_TOP } from './config.js';
import { hitsBuilding, inWater } from './world.js';
import { burst } from './cars.js';

// The helipad sits on the sand at the east end of the beach, clear of
// buildings and roads; the plane parks on the same sand at the west end,
// so the whole beach is its runway.
export const HELIPAD = { x: 1900, y: 1500 };
export const AIRSTRIP = { x: 240, y: 1510 };

// The roof height of the building at (x, y), or 0 on open ground. It
// mirrors the height formula the 3D renderer uses for the same buildings,
// so a helicopter that stays above this number never clips a roof.
function hash01(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function buildingTopAt(world, x, y) {
  let top = 0;
  for (const b of world.buildings) {
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
      const h = b.tall ? 150 + hash01(b.x, b.y) * 230 : 38 + hash01(b.x, b.y) * 72;
      if (h > top) top = h;
    }
  }
  return top;
}

// ---------------------------------------------------------------- helicopter

export function createFlyHeli() {
  return {
    x: HELIPAD.x, y: HELIPAD.y, angle: -Math.PI / 2,
    alt: 0, speed: 0, vSpeed: 0, hp: 100,
    isHeli: true, kind: 'heli', rotor: 0, crashCd: 0, landed: true,
  };
}

function heliCrash(G, heli, reason) {
  burst(G, heli.x, heli.y, '#e8862f', 30, 320);
  burst(G, heli.x, heli.y, '#3a3a3a', 20, 200);
  burst(G, heli.x, heli.y, '#f2c94c', 16, 260);
  G.shake = 16;
  G.audio.explosion();
  G.wasted(reason);
}

// W/S fly forward and back, A/D turn, Space climbs, Shift or C sinks.
// A helicopter hovers: let go and it hangs in the air. Landings are the
// skill — come down gently, on open ground, or the skids pay for it.
export function driveHeli(G, input, dt) {
  const h = G.flyHeli;
  const p = G.player;
  const up = input.down('KeyW') || input.down('ArrowUp');
  const down = input.down('KeyS') || input.down('ArrowDown');
  const left = input.down('KeyA') || input.down('ArrowLeft');
  const right = input.down('KeyD') || input.down('ArrowRight');
  const climb = input.down('Space');
  const sink = input.down('ShiftLeft') || input.down('ShiftRight') || input.down('ControlLeft') || input.down('KeyC');

  const targetSpeed = up ? 320 : down ? -120 : 0;
  h.speed += (targetSpeed - h.speed) * Math.min(1, 1.8 * dt);
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  h.angle += steer * 1.7 * dt;
  const targetV = climb ? 130 : sink ? -110 : 0;
  h.vSpeed += (targetV - h.vSpeed) * Math.min(1, 2.2 * dt);
  h.crashCd -= dt;

  const nx = h.x + Math.cos(h.angle) * h.speed * dt;
  const ny = h.y + Math.sin(h.angle) * h.speed * dt;
  // Low over a roof the heli slides around it instead of through it.
  const top = buildingTopAt(G.world, nx, ny);
  if (top > 0 && h.alt < top + 15) {
    if (Math.abs(h.speed) > 150 && h.crashCd <= 0) {
      h.crashCd = 1;
      h.hp -= 12;
      G.shake = Math.min(14, G.shake + 8);
      G.audio.crash(true);
      G.feed.push('You clipped a rooftop!');
      if (h.hp <= 0) {
        heliCrash(G, h, 'You wrecked the helicopter on a roof.');
        return;
      }
    }
  } else {
    h.x = nx;
    h.y = ny;
  }
  h.x = Math.max(40, Math.min(WORLD_W - 40, h.x));
  h.y = Math.max(40, Math.min(WORLD_H - 40, h.y));

  h.alt += h.vSpeed * dt;
  // The sea is not a landing pad: the heli holds 30 units over water.
  const overSea = h.y >= SEA_TOP || inWater(G.world, h.x, h.y);
  const groundTop = buildingTopAt(G.world, h.x, h.y);
  const minAlt = overSea ? 30 : groundTop > 0 ? groundTop + 25 : 0;
  if (h.alt <= minAlt) {
    if (h.vSpeed < -95) {
      h.hp -= 30;
      G.shake = Math.min(16, G.shake + 10);
      G.audio.crash(true);
      burst(G, h.x, h.y, '#e8e8e8', 12, 180);
      G.feed.push('Hard landing! Bring her down gently.');
      if (h.hp <= 0) {
        heliCrash(G, h, 'You crashed the helicopter.');
        return;
      }
    }
    h.alt = minAlt;
    h.vSpeed = 0;
    h.speed *= Math.max(0, 1 - 3 * dt);
  }
  h.landed = h.alt === 0 && groundTop === 0 && !overSea;
  p.x = h.x;
  p.y = h.y;
  p.angle = h.angle;
}

// ------------------------------------------------------- police helicopter

export function spawnPoliceHeli(G) {
  if (G.policeHeli) return G.policeHeli;
  // Start ahead-left of the player's heading, so the chopper is in frame
  // the moment it arrives — including in the chase screenshot.
  const a = G.player.angle - 0.6;
  G.policeHeli = {
    x: G.player.x + Math.cos(a) * 280,
    y: G.player.y + Math.sin(a) * 280,
    angle: a, orbit: a, alt: 260, rotor: 0, police: true,
  };
  G.feed.push('Police helicopter overhead!');
  return G.policeHeli;
}

export function updatePoliceHeli(G, dt) {
  const heli = G.policeHeli;
  if (!heli) return;
  if (G.wanted === 0) {
    G.policeHeli = null;
    return;
  }
  // A slow circle around the player, nose along the orbit, bobbing a
  // little. It stays low — just above the roofs it passes — so the
  // chase camera can actually see it in the sky. It never shoots — but
  // while it watches, the heat never dies down: the player cannot lose
  // the cops from the air.
  heli.orbit += dt * 0.32;
  const r = 300;
  heli.x = G.player.x + Math.cos(heli.orbit) * r;
  heli.y = G.player.y + Math.sin(heli.orbit) * r;
  heli.angle = heli.orbit + Math.PI / 2;
  const roof = buildingTopAt(G.world, heli.x, heli.y);
  heli.alt = Math.max(150, roof + 40) + Math.sin(G.time * 0.7) * 8;
}

// ------------------------------------------------------------- ambient planes

export function createAmbientPlanes() {
  const planes = [];
  for (let i = 0; i < 3; i += 1) {
    planes.push({
      x: -400 - i * 700, y: 320 + i * 420, alt: 520 + i * 80,
      angle: 0.1 + i * 0.05, speed: 150 + i * 35, ambient: true,
    });
  }
  return planes;
}

export function updateAmbientPlanes(G, dt) {
  for (const p of G.planes) {
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;
    if (p.x > WORLD_W + 700) {
      p.x = -700;
      p.y = 200 + Math.random() * 1100;
      p.alt = 500 + Math.random() * 220;
      p.angle = (Math.random() - 0.5) * 0.3;
    }
  }
}

// -------------------------------------------------------------- flyable plane

export function createFlyPlane() {
  return {
    x: AIRSTRIP.x, y: AIRSTRIP.y, angle: 0,
    alt: 0, speed: 0, vSpeed: 0, hp: 100,
    isPlane: true, kind: 'plane', airborne: false, crashCd: 0, bank: 0,
  };
}

function planeCrash(G, pl, reason) {
  burst(G, pl.x, pl.y, '#e8862f', 30, 320);
  burst(G, pl.x, pl.y, '#3a3a3a', 20, 200);
  burst(G, pl.x, pl.y, '#f2c94c', 16, 260);
  G.shake = 16;
  G.audio.explosion();
  G.wasted(reason);
}

// A light prop plane on the beach strip. On the ground W is the throttle
// and S the brake; past 250 it lifts off on its own if the throttle stays
// open. In the air W pulls up, S pushes down, Space climbs harder, A/D
// bank into turns. Landings only count on the sand — anywhere else is a
// crash, so line the strip up before coming down.
export function drivePlane(G, input, dt) {
  const pl = G.flyPlane;
  const p = G.player;
  const up = input.down('KeyW') || input.down('ArrowUp');
  const down = input.down('KeyS') || input.down('ArrowDown');
  const left = input.down('KeyA') || input.down('ArrowLeft');
  const right = input.down('KeyD') || input.down('ArrowRight');
  const climb = input.down('Space');
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  pl.crashCd -= dt;

  if (!pl.airborne) {
    if (up) pl.speed += 150 * dt;
    else if (down) pl.speed -= 260 * dt;
    else pl.speed -= pl.speed * 0.5 * dt;
    pl.speed = Math.max(0, Math.min(400, pl.speed));
    pl.angle += steer * 1.1 * Math.min(1, pl.speed / 120) * dt;
    if (pl.speed > 250 && (climb || up)) {
      pl.airborne = true;
      pl.vSpeed = 40;
      G.feed.push('Airborne! W/S climb and descend, A/D turn.');
      G.audio.jingle();
    }
  } else {
    if (up) pl.vSpeed += 90 * dt;
    else if (down) pl.vSpeed -= 90 * dt;
    else pl.vSpeed -= pl.vSpeed * 0.4 * dt;
    if (climb) pl.vSpeed += 60 * dt;
    pl.vSpeed = Math.max(-110, Math.min(120, pl.vSpeed));
    pl.speed += (340 - pl.speed) * Math.min(1, 0.5 * dt);
    pl.angle += steer * 1.4 * dt;
    pl.bank += ((steer * 0.5) - pl.bank) * Math.min(1, 4 * dt);
    pl.alt += pl.vSpeed * dt;
    // Rooftops are a ceiling, not a wall: the plane slides over them.
    const top = buildingTopAt(G.world, pl.x, pl.y);
    if (top > 0 && pl.alt < top + 20) pl.alt = top + 20;
    if (pl.alt <= 0) {
      const onSand = pl.y >= SAND_TOP && pl.y < SEA_TOP;
      if (onSand && Math.abs(pl.vSpeed) < 120) {
        pl.alt = 0;
        pl.vSpeed = 0;
        pl.airborne = false;
        pl.bank = 0;
        G.feed.push('Landed on the beach strip.');
      } else if (pl.y >= SEA_TOP || inWater(G.world, pl.x, pl.y)) {
        planeCrash(G, pl, 'You ditched the plane in the sea.');
        return;
      } else {
        planeCrash(G, pl, 'You crashed the plane into the city.');
        return;
      }
    }
  }

  const nx = pl.x + Math.cos(pl.angle) * pl.speed * dt;
  const ny = pl.y + Math.sin(pl.angle) * pl.speed * dt;
  if (pl.airborne) {
    pl.x = nx;
    pl.y = ny;
  } else {
    if (!hitsBuilding(G.world, nx, pl.y, 18)) pl.x = nx;
    if (!hitsBuilding(G.world, pl.x, ny, 18)) pl.y = ny;
    if (pl.y >= SEA_TOP - 10) {
      pl.y = SEA_TOP - 10;
      pl.speed *= 0.5;
    }
  }
  pl.x = Math.max(30, Math.min(WORLD_W - 30, pl.x));
  pl.y = Math.max(30, Math.min(WORLD_H - 30, pl.y));
  p.x = pl.x;
  p.y = pl.y;
  p.angle = pl.angle;
}
