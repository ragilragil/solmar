// The player: walking the streets, stealing cars, punching and shooting.
// Everything the player does on foot lives here; driving itself is in cars.js,
// flying in aircraft.js, and the weapons in weapons.js.
import {
  TILE, WORLD_W, SAND_TOP, WALK_SPEED, RUN_SPEED, PUNCH_RANGE,
  PISTOL_AMMO, BUSTED_HOLD_SECONDS,
} from './config.js';
import { blocked } from './world.js';
import { nearestCar, knockPed, fleePeds } from './cars.js';
import {
  createWeaponState, fireWeapon, switchWeapon, cycleWeapon, addAmmo,
} from './weapons.js';

export function createPlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2, hp: 100, money: 250,
    weapons: createWeaponState(),
    onFoot: true, car: null, heli: null, plane: null, punchCd: 0, shootCd: 0, shootWantedCd: 0,
    bustedT: 0, walkPhase: 0,
  };
}

function moveOnFoot(G, input, dt) {
  const p = G.player;
  let mx = 0;
  let my = 0;
  if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
  if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
  if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
  if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
  if (mx === 0 && my === 0) return;
  const len = Math.hypot(mx, my);
  mx /= len;
  my /= len;
  const running = input.down('ShiftLeft') || input.down('ShiftRight');
  const speed = running ? RUN_SPEED : WALK_SPEED;
  const nx = p.x + mx * speed * dt;
  const ny = p.y + my * speed * dt;
  if (!blocked(G.world, nx, p.y, 14)) p.x = nx;
  if (!blocked(G.world, p.x, ny, 14)) p.y = ny;
  p.angle = Math.atan2(my, mx);
  p.walkPhase += dt * (running ? 11 : 7);
}

function tryPunch(G) {
  const p = G.player;
  if (p.punchCd > 0) return;
  p.punchCd = 0.4;
  G.audio.punch();
  let hit = false;
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    if (Math.hypot(ped.x - p.x, ped.y - p.y) < PUNCH_RANGE) {
      knockPed(G, ped, p.x, p.y);
      G.addWanted(1);
      G.feed.push('You punched a pedestrian!');
      hit = true;
      break;
    }
  }
  if (!hit) {
    // A swing at the air still makes the point.
    G.feed.push('You swung at the air.');
  }
}

function enterExitCar(G, input) {
  const p = G.player;
  if (p.car) {
    const car = p.car;
    const side = car.angle + Math.PI / 2;
    const px = car.x + Math.cos(side) * 34;
    const py = car.y + Math.sin(side) * 34;
    if (!blocked(G.world, px, py, 14)) {
      p.x = px;
      p.y = py;
    } else {
      p.x = car.x - Math.cos(side) * 34;
      p.y = car.y - Math.sin(side) * 34;
    }
    p.angle = car.angle;
    car.kind = 'parked';
    car.speed = 0;
    p.car = null;
    p.onFoot = true;
    G.feed.push('You got out of the car.');
    return;
  }
  if (p.heli) {
    // No bailing out mid-air: land the chopper first.
    if (p.heli.alt > 0) {
      G.feed.push('Land the helicopter first!');
      return;
    }
    const h = p.heli;
    const side = h.angle + Math.PI / 2;
    p.x = h.x + Math.cos(side) * 40;
    p.y = h.y + Math.sin(side) * 40;
    p.angle = h.angle;
    p.heli = null;
    p.onFoot = true;
    G.feed.push('You got out of the helicopter.');
    return;
  }
  if (p.plane) {
    if (p.plane.alt > 0) {
      G.feed.push('Land the plane first!');
      return;
    }
    const pl = p.plane;
    const side = pl.angle + Math.PI / 2;
    p.x = pl.x + Math.cos(side) * 40;
    p.y = pl.y + Math.sin(side) * 40;
    p.angle = pl.angle;
    p.plane = null;
    p.onFoot = true;
    G.feed.push('You got out of the plane.');
    return;
  }
  // Boarding: the helicopter on its helipad first, then the plane on the
  // beach strip, then the nearest car — the aircraft sit on open ground
  // where no car is ever parked, so the order never steals a car entry.
  const heli = G.flyHeli;
  if (heli && heli.alt === 0 && Math.hypot(heli.x - p.x, heli.y - p.y) < 90) {
    p.heli = heli;
    p.onFoot = false;
    p.x = heli.x;
    p.y = heli.y;
    G.feed.push('You took the helicopter! Space climbs, Shift sinks.');
    return;
  }
  const plane = G.flyPlane;
  if (plane && plane.alt === 0 && Math.hypot(plane.x - p.x, plane.y - p.y) < 90) {
    p.plane = plane;
    p.onFoot = false;
    p.x = plane.x;
    p.y = plane.y;
    G.feed.push('You took the plane! Hold W to throttle up the beach.');
    return;
  }
  const car = nearestCar(G, p.x, p.y, 78);
  if (!car) {
    G.feed.push('No car close enough — walk up to one.');
    return;
  }
  p.car = car;
  car.kind = 'player';
  p.onFoot = false;
  p.x = car.x;
  p.y = car.y;
  if (car.stolen !== true) {
    car.stolen = true;
    G.addWanted(1);
    G.feed.push('You stole a car! The cops noticed.');
    G.audio.crash(false);
  } else {
    G.feed.push('Back behind the wheel.');
  }
}

export function updatePlayer(G, input, dt) {
  const p = G.player;
  p.punchCd -= dt;
  p.shootCd -= dt;
  p.shootWantedCd -= dt;

  if (input.pressed('KeyE')) enterExitCar(G, input);

  if (p.car) {
    // Driving is handled in cars.js; the player just rides along.
    p.x = p.car.x;
    p.y = p.car.y;
    p.angle = p.car.angle;
    return;
  }
  if (p.heli) {
    // Flying is handled in aircraft.js; the player just rides along.
    p.x = p.heli.x;
    p.y = p.heli.y;
    p.angle = p.heli.angle;
    return;
  }
  if (p.plane) {
    p.x = p.plane.x;
    p.y = p.plane.y;
    p.angle = p.plane.angle;
    return;
  }

  moveOnFoot(G, input, dt);

  if (input.pressed('Digit1')) switchWeapon(G, 'pistol');
  if (input.pressed('Digit2')) switchWeapon(G, 'shotgun');
  if (input.pressed('Digit3')) switchWeapon(G, 'rifle');
  if (input.pressed('Digit4')) switchWeapon(G, 'rocket');
  if (input.pressed('KeyQ')) cycleWeapon(G);

  if (input.pressed('KeyF') || input.clickedLeft()) tryPunch(G);
  fireWeapon(G, input);

  // A police car leaning on the player on foot hurts and builds the bust.
  for (const car of G.cars) {
    if (car.kind !== 'police') continue;
    if (Math.hypot(car.x - p.x, car.y - p.y) < 44) {
      p.hp -= 10 * dt;
      if (p.hp <= 0) {
        G.wasted('The police ran you down.');
        return;
      }
    }
  }
  p.bustedT = Math.max(0, p.bustedT - dt * 0.4);
  if (p.bustedT >= BUSTED_HOLD_SECONDS) {
    G.busted('The police caught you on foot.');
  }

  // Pickups: walk over a green cross for health, a yellow box for ammo.
  // The ammo feeds whatever weapon is in hand.
  for (const pickup of G.world.pickups) {
    if (pickup.taken) continue;
    if (Math.hypot(pickup.x - p.x, pickup.y - p.y) < 28) {
      pickup.taken = true;
      pickup.respawn = 20;
      if (pickup.kind === 'health') {
        p.hp = Math.min(100, p.hp + 40);
        G.feed.push('Health +40');
      } else {
        addAmmo(G, PISTOL_AMMO);
        G.feed.push('Ammo +12');
      }
      G.audio.pickup();
    }
  }
}

export function updatePickups(G, dt) {
  for (const pickup of G.world.pickups) {
    if (!pickup.taken) continue;
    pickup.respawn -= dt;
    if (pickup.respawn <= 0) pickup.taken = false;
  }
}
