// Cars and people: parked cars to steal, traffic that follows the road
// graph, police that chase the player, pedestrians on the sidewalks, bullets
// and the little bursts of dust and sparks that sell a crash. Every actor is
// a plain object on G; this module owns how they move and collide.
import {
  TILE, WORLD_W, WORLD_H, V_ROADS, H_ROADS, ROAD_W, SAND_TOP, SEA_TOP,
  PALETTE, CAR_TOP_SPEED, CAR_ACCEL, CAR_BRAKE, POLICE_TOP_SPEED,
  TRAFFIC_SPEED, BULLET_SPEED,
} from './config.js';
import { blocked, hitsBuilding } from './world.js';

const LANE = ROAD_W / 4;

export function burst(G, x, y, color, n, speed) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const v = (speed || 120) * (0.4 + Math.random() * 0.8);
    G.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.5 + Math.random() * 0.5, maxLife: 1,
      color, size: 2 + Math.random() * 3,
    });
  }
  if (G.particles.length > 400) G.particles.splice(0, G.particles.length - 400);
}

export function makeCar(x, y, angle, color, kind) {
  return {
    x, y, angle, speed: 0, color, kind,
    hp: kind === 'police' ? 60 : 100,
    node: null, fromNode: null, targetNode: null,
    laneX: 0, laneY: 0, ramCd: 0, stuckT: 0, reverseT: 0,
  };
}

function nodeNeighbours(G, node) {
  const out = [];
  for (const other of G.world.intersections) {
    const sameRow = other.j === node.j && Math.abs(other.i - node.i) === 1;
    const sameCol = other.i === node.i && Math.abs(other.j - node.j) === 1;
    if (sameRow || sameCol) out.push(other);
  }
  return out;
}

function pickNextNode(G, car) {
  const options = nodeNeighbours(G, car.node).filter((n) => n !== car.fromNode);
  const next = options.length ? options[Math.floor(Math.random() * options.length)] : car.fromNode;
  car.fromNode = car.node;
  car.node = car.targetNode;
  car.targetNode = next;
  // Lane offset: right-hand traffic, on the side the car drives on.
  const dx = next.x - car.node.x;
  const dy = next.y - car.node.y;
  const len = Math.hypot(dx, dy) || 1;
  car.laneX = (-dy / len) * LANE;
  car.laneY = (dx / len) * LANE;
}

function moveWithCollision(G, car, dx, dy) {
  const nx = car.x + dx;
  const ny = car.y + dy;
  if (!blocked(G.world, nx, ny, 18)) {
    car.x = nx;
    car.y = ny;
    return true;
  }
  if (!blocked(G.world, nx, car.y, 18)) {
    car.x = nx;
    return true;
  }
  if (!blocked(G.world, car.x, ny, 18)) {
    car.y = ny;
    return true;
  }
  return false;
}

export function spawnParkedCars(G) {
  const rng = G.rng;
  for (let i = 0; i < 18; i += 1) {
    const vertical = rng.next() < 0.5;
    let x; let y;
    if (vertical) {
      const road = rng.pick(V_ROADS);
      const edge = rng.next() < 0.5 ? -1 : 1;
      x = road * TILE + (edge < 0 ? -TILE * 0.4 : ROAD_W + TILE * 0.4);
      y = rng.range(TILE * 2, SAND_TOP - TILE * 2);
    } else {
      const road = rng.pick(H_ROADS);
      const edge = rng.next() < 0.5 ? -1 : 1;
      x = rng.range(TILE * 2, WORLD_W - TILE * 2);
      y = road * TILE + (edge < 0 ? -TILE * 0.4 : ROAD_W + TILE * 0.4);
    }
    if (blocked(G.world, x, y, 24)) continue;
    const angle = vertical ? Math.PI / 2 : 0;
    G.cars.push(makeCar(x, y, angle, rng.pick(PALETTE.car), 'parked'));
  }
}

export function spawnTraffic(G, n) {
  for (let i = 0; i < n; i += 1) {
    const node = G.world.intersections[Math.floor(Math.random() * G.world.intersections.length)];
    const car = makeCar(node.x, node.y, 0, Math.random() < 0.85 ? PALETTE.car[Math.floor(Math.random() * PALETTE.car.length)] : '#e8e8e8', 'traffic');
    car.node = node;
    car.fromNode = node;
    const neighbours = nodeNeighbours(G, node);
    car.targetNode = neighbours[Math.floor(Math.random() * neighbours.length)];
    const dx = car.targetNode.x - node.x;
    const dy = car.targetNode.y - node.y;
    const len = Math.hypot(dx, dy) || 1;
    car.laneX = (-dy / len) * LANE;
    car.laneY = (dx / len) * LANE;
    car.angle = Math.atan2(dy, dx);
    car.speed = TRAFFIC_SPEED * (0.8 + Math.random() * 0.4);
    G.cars.push(car);
  }
}

export function spawnPoliceCar(G) {
  const player = G.player;
  const spots = G.world.intersections.filter((n) => {
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    return d > 500 && d < 1000;
  });
  const node = spots.length ? spots[Math.floor(Math.random() * spots.length)]
    : G.world.intersections[Math.floor(Math.random() * G.world.intersections.length)];
  const car = makeCar(node.x, node.y, 0, '#1c1e26', 'police');
  car.speed = POLICE_TOP_SPEED * 0.6;
  G.cars.push(car);
  return car;
}

// A roadblock: two police cars parked side by side across the road the
// player is travelling on, so the street is sealed until the player rams
// through or goes around. They never chase — they hold the line.
export function spawnRoadblock(G, x, y, roadAngle) {
  const px = -Math.sin(roadAngle);
  const py = Math.cos(roadAngle);
  const made = [];
  for (const side of [-1, 1]) {
    const car = makeCar(x + px * 30 * side, y + py * 30 * side, roadAngle + Math.PI / 2, '#1c1e26', 'police');
    car.roadblock = true;
    car.speed = 0;
    G.cars.push(car);
    made.push(car);
  }
  G.feed.push('Roadblock ahead!');
  return made;
}

function randomRoad() {
  if (Math.random() < 0.5) {
    return { type: 'v', idx: Math.floor(Math.random() * V_ROADS.length), side: Math.random() < 0.5 ? -1 : 1 };
  }
  return { type: 'h', idx: Math.floor(Math.random() * H_ROADS.length), side: Math.random() < 0.5 ? -1 : 1 };
}

function sidewalkPoint(G, road) {
  // A point on a sidewalk beside one road. When a road is given, the point
  // stays on that same street, so pedestrians walk along the sidewalks
  // instead of jaywalking across the blocks and the roads.
  const r = road || randomRoad();
  if (r.type === 'v') {
    const tile = V_ROADS[r.idx];
    const x = tile * TILE + (r.side < 0 ? -TILE * 0.6 : ROAD_W + TILE * 0.6);
    return { x, y: TILE + Math.random() * (SAND_TOP - TILE * 2), road: r };
  }
  const tile = H_ROADS[r.idx];
  const y = tile * TILE + (r.side < 0 ? -TILE * 0.6 : ROAD_W + TILE * 0.6);
  return { x: TILE + Math.random() * (WORLD_W - TILE * 2), y, road: r };
}

export function spawnPeds(G, n) {
  for (let i = 0; i < n; i += 1) {
    const spot = sidewalkPoint(G);
    if (blocked(G.world, spot.x, spot.y, 10)) continue;
    G.peds.push({
      x: spot.x, y: spot.y, angle: Math.random() * Math.PI * 2,
      speed: 45 + Math.random() * 35, state: 'walk',
      color: PALETTE.ped[Math.floor(Math.random() * PALETTE.ped.length)],
      timer: 0, tx: spot.x, ty: spot.y, road: spot.road,
    });
  }
  // A few pairs start out chatting on the sidewalk, facing each other, so
  // the street reads as lived-in from the first frame instead of only
  // after a minute of play.
  for (let i = 0; i < 4; i += 1) {
    const a = G.peds[Math.floor(Math.random() * G.peds.length)];
    if (!a) continue;
    let b = null;
    let bestD = 120;
    for (const other of G.peds) {
      if (other === a || other.state !== 'walk') continue;
      const d = Math.hypot(other.x - a.x, other.y - a.y);
      if (d < bestD) {
        bestD = d;
        b = other;
      }
    }
    if (!b) continue;
    a.state = 'chat';
    b.state = 'chat';
    a.timer = 6 + Math.random() * 8;
    b.timer = a.timer;
    a.angle = Math.atan2(b.y - a.y, b.x - a.x);
    b.angle = Math.atan2(a.y - b.y, a.x - b.x);
  }
}

// The opposite sidewalk at the nearest intersection: a ped crossing the
// road walks on the crosswalk instead of jaywalking mid-block.
function crosswalkTarget(G, ped) {
  let best = G.world.intersections[0];
  let bestD = Infinity;
  for (const n of G.world.intersections) {
    const d = Math.hypot(n.x - ped.x, n.y - ped.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  const r = ped.road;
  if (r.type === 'v') {
    const tile = V_ROADS[r.idx];
    const x = tile * TILE + (r.side < 0 ? ROAD_W + TILE * 0.6 : -TILE * 0.6);
    return { x, y: best.y, road: { type: 'v', idx: r.idx, side: -r.side } };
  }
  const tile = H_ROADS[r.idx];
  const y = tile * TILE + (r.side < 0 ? ROAD_W + TILE * 0.6 : -TILE * 0.6);
  return { x: best.x, y, road: { type: 'h', idx: r.idx, side: -r.side } };
}

function updateTraffic(G, car, dt) {
  const tx = car.targetNode.x + car.laneX;
  const ty = car.targetNode.y + car.laneY;
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
  // Slow down for the car ahead in the same lane.
  let targetSpeed = TRAFFIC_SPEED;
  for (const other of G.cars) {
    if (other === car || other.kind === 'parked') continue;
    const ox = other.x - car.x;
    const oy = other.y - car.y;
    const ahead = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
    const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 70 && side < 30) targetSpeed = Math.min(targetSpeed, other.speed * 0.7);
  }
  car.speed += (targetSpeed - car.speed) * Math.min(1, 2 * dt);
  const moved = moveWithCollision(G, car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt);
  if (!moved) {
    car.stuckT += dt;
    if (car.stuckT > 1.2) {
      car.stuckT = 0;
      pickNextNode(G, car);
    }
  } else {
    car.stuckT = 0;
  }
  if (dist < 26) pickNextNode(G, car);
}

function updatePolice(G, car, dt) {
  const player = G.player;
  // A roadblock car holds its ground: it never chases, it just seals the
  // road until the player rams it aside (handled in updateCars).
  if (car.roadblock) {
    car.ramCd -= dt;
    car.speed = 0;
    return;
  }
  const dx = player.x - car.x;
  const dy = player.y - car.y;
  const dist = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turnRate = car.reverseT > 0 ? -2.6 : 3.1;
  car.angle += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    car.speed = -140;
  } else {
    car.speed += (POLICE_TOP_SPEED - car.speed) * Math.min(1, 1.6 * dt);
  }
  const moved = moveWithCollision(G, car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt);
  if (!moved) {
    car.stuckT += dt;
    if (car.stuckT > 1.5) {
      car.stuckT = 0;
      car.reverseT = 0.6;
    }
  } else {
    car.stuckT = 0;
  }
  car.ramCd -= dt;
  // Ramming the player's car, or leaning on the player on foot.
  if (dist < 46 && car.ramCd <= 0) {
    car.ramCd = 1.0;
    if (player.car) {
      player.car.hp -= 6;
      player.car.speed *= 0.6;
      G.shake = Math.min(14, G.shake + 7);
      G.audio.crash(true);
      burst(G, car.x, car.y, '#e8e8e8', 8, 140);
      G.feed.push('Police rammed your car!');
      if (player.car.hp <= 0) G.busted('Your car was wrecked by the police.');
    } else {
      player.bustedT += 0.7;
      G.feed.push('The police are grabbing you — run!');
    }
  }
}

export function updateCars(G, dt) {
  for (const car of G.cars) {
    if (car.kind === 'traffic') updateTraffic(G, car, dt);
    else if (car.kind === 'police') updatePolice(G, car, dt);
  }
  // Gentle separation so traffic does not stack on top of itself. The
  // player's car is never pushed: it answers to the player, and the police
  // ram it through their own rule instead of shoving it into buildings.
  for (let i = 0; i < G.cars.length; i += 1) {
    for (let j = i + 1; j < G.cars.length; j += 1) {
      const a = G.cars[i];
      const b = G.cars[j];
      if (a.kind === 'player' || b.kind === 'player') continue;
      if (a.kind === 'parked' && b.kind === 'parked') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < 44) {
        const push = (44 - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        if (a.kind !== 'parked') { a.x -= nx * push; a.y -= ny * push; }
        if (b.kind !== 'parked') { b.x += nx * push; b.y += ny * push; }
      }
    }
  }
  // The player's car running over a pedestrian.
  const pc = G.player.car;
  if (pc && Math.abs(pc.speed) > 60) {
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      if (Math.hypot(ped.x - pc.x, ped.y - pc.y) < 30) {
        knockPed(G, ped, pc.x, pc.y);
        G.addWanted(1);
        G.audio.crash(false);
        G.feed.push('You hit a pedestrian!');
      }
    }
  }
  // The player's car smashing a roadblock: it costs paint and speed, but
  // the roadblock gives way — ramming through is always an option.
  if (pc) {
    for (const car of G.cars) {
      if (!car.roadblock || car.ramCd > 0) continue;
      const d = Math.hypot(car.x - pc.x, car.y - pc.y);
      if (d < 46) {
        car.ramCd = 1.2;
        pc.hp -= 4;
        pc.speed *= 0.35;
        G.shake = Math.min(14, G.shake + 8);
        G.audio.crash(true);
        burst(G, car.x, car.y, '#e8e8e8', 10, 160);
        const nx = (car.x - pc.x) / (d || 1);
        const ny = (car.y - pc.y) / (d || 1);
        car.x += nx * 34;
        car.y += ny * 34;
        G.feed.push('You smashed through a roadblock!');
        if (pc.hp <= 0) G.busted('You wrecked your car on a roadblock.');
      }
    }
  }
}

export function knockPed(G, ped, fromX, fromY) {
  ped.state = 'down';
  ped.timer = 12;
  ped.angle = Math.atan2(ped.y - fromY, ped.x - fromX);
  burst(G, ped.x, ped.y, '#e86a6a', 10, 130);
}

export function updatePeds(G, dt) {
  for (const ped of G.peds) {
    ped.timer -= dt;
    if (ped.state === 'down') {
      if (ped.timer <= 0) {
        // Get up on a nearby sidewalk and walk away.
        const spot = sidewalkPoint(G);
        ped.x = spot.x;
        ped.y = spot.y;
        ped.road = spot.road;
        ped.state = 'walk';
        ped.timer = 0;
      }
      continue;
    }
    if (ped.state === 'flee') {
      const dx = ped.x - ped.tx;
      const dy = ped.y - ped.ty;
      const d = Math.hypot(dx, dy) || 1;
      const nx = ped.x + (dx / d) * 210 * dt;
      const ny = ped.y + (dy / d) * 210 * dt;
      if (!blocked(G.world, nx, ny, 10)) {
        ped.x = nx;
        ped.y = ny;
      }
      ped.angle = Math.atan2(dy, dx);
      if (ped.timer <= 0) ped.state = 'walk';
      continue;
    }
    if (ped.state === 'chat') {
      // Standing and talking: face the nearest other chatter, then drift on.
      if (ped.timer <= 0) {
        ped.state = 'walk';
        const spot = sidewalkPoint(G, ped.road);
        ped.tx = spot.x;
        ped.ty = spot.y;
      }
      continue;
    }
    // Walking: drift toward a target on the same street, then pick a new
    // one further along it. Sometimes the ped pauses to chat with the
    // nearest walker, or crosses the street on the nearest crosswalk.
    const dx = ped.tx - ped.x;
    const dy = ped.ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) {
      const roll = Math.random();
      if (roll < 0.18) {
        let other = null;
        let bestD = 90;
        for (const o of G.peds) {
          if (o === ped || o.state !== 'walk') continue;
          const od = Math.hypot(o.x - ped.x, o.y - ped.y);
          if (od < bestD) {
            bestD = od;
            other = o;
          }
        }
        if (other) {
          ped.state = 'chat';
          ped.timer = 5 + Math.random() * 6;
          ped.angle = Math.atan2(other.y - ped.y, other.x - ped.x);
          other.state = 'chat';
          other.timer = ped.timer;
          other.angle = Math.atan2(ped.y - other.y, ped.x - other.x);
          continue;
        }
      } else if (roll < 0.43) {
        const cross = crosswalkTarget(G, ped);
        ped.tx = cross.x;
        ped.ty = cross.y;
        ped.road = cross.road;
        continue;
      }
      const spot = sidewalkPoint(G, ped.road);
      ped.tx = spot.x;
      ped.ty = spot.y;
      continue;
    }
    ped.angle = Math.atan2(dy, dx);
    const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
    if (!blocked(G.world, nx, ny, 10)) {
      ped.x = nx;
      ped.y = ny;
    } else {
      const spot = sidewalkPoint(G, ped.road);
      ped.tx = spot.x;
      ped.ty = spot.y;
    }
  }
}

export function fleePeds(G, x, y, radius) {
  for (const ped of G.peds) {
    if (ped.state !== 'walk' && ped.state !== 'chat') continue;
    if (Math.hypot(ped.x - x, ped.y - y) < radius) {
      ped.state = 'flee';
      ped.tx = x;
      ped.ty = y;
      ped.timer = 2.5;
    }
  }
}

export function updateBullets(G, dt) {
  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    const speed = b.speed || BULLET_SPEED;
    b.x += Math.cos(b.angle) * speed * dt;
    b.y += Math.sin(b.angle) * speed * dt;
    b.life -= dt;
    let dead = b.life <= 0 || hitsBuilding(G.world, b.x, b.y, 2) || b.y >= SEA_TOP;
    if (!dead) {
      for (const ped of G.peds) {
        if (ped.state !== 'down' && Math.hypot(ped.x - b.x, ped.y - b.y) < 20) {
          knockPed(G, ped, G.player.x, G.player.y);
          G.addWanted(2);
          G.feed.push('You shot a pedestrian!');
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const car of G.cars) {
        if (car.kind !== 'police') continue;
        if (Math.hypot(car.x - b.x, car.y - b.y) < 26) {
          car.hp -= b.dmg || 20;
          burst(G, b.x, b.y, '#f2c94c', 8, 150);
          G.addWanted(2);
          if (car.hp <= 0) {
            burst(G, car.x, car.y, '#e8862f', 26, 260);
            burst(G, car.x, car.y, '#3a3a3a', 18, 160);
            G.cars.splice(G.cars.indexOf(car), 1);
            G.feed.push('Police car destroyed!');
          }
          dead = true;
          break;
        }
      }
    }
    // A rocket bursts on anything it touches — a wall, a ped, a police
    // car, or the end of its flight — and hurts everything nearby.
    if (dead && b.explosive) explodeBullet(G, b);
    if (dead) G.bullets.splice(i, 1);
  }
}

function explodeBullet(G, b) {
  const r = b.blast || 110;
  burst(G, b.x, b.y, '#e8862f', 26, 300);
  burst(G, b.x, b.y, '#3a3a3a', 16, 180);
  burst(G, b.x, b.y, '#f2c94c', 14, 220);
  G.shake = Math.min(16, G.shake + 9);
  G.audio.explosion();
  for (const ped of G.peds) {
    if (ped.state !== 'down' && Math.hypot(ped.x - b.x, ped.y - b.y) < r) {
      knockPed(G, ped, b.x, b.y);
    }
  }
  for (let i = G.cars.length - 1; i >= 0; i -= 1) {
    const car = G.cars[i];
    if (car.kind !== 'police') continue;
    if (Math.hypot(car.x - b.x, car.y - b.y) < r) {
      car.hp -= b.dmg || 90;
      if (car.hp <= 0) {
        burst(G, car.x, car.y, '#e8862f', 26, 260);
        burst(G, car.x, car.y, '#3a3a3a', 18, 160);
        G.cars.splice(i, 1);
        G.feed.push('Police car destroyed!');
      }
    }
  }
  G.addWanted(2);
  fleePeds(G, b.x, b.y, 380);
}

// The player's own driving: arcade handling with a handbrake drift.
export function drivePlayerCar(G, input, dt) {
  const car = G.player.car;
  if (!car) return;
  const up = input.down('KeyW') || input.down('ArrowUp');
  const down = input.down('KeyS') || input.down('ArrowDown');
  const left = input.down('KeyA') || input.down('ArrowLeft');
  const right = input.down('KeyD') || input.down('ArrowRight');
  const brake = input.down('Space');
  const speedRatio = Math.min(1, Math.abs(car.speed) / CAR_TOP_SPEED);

  if (up) car.speed += CAR_ACCEL * dt;
  else if (down) {
    if (car.speed > 20) car.speed -= CAR_BRAKE * dt;
    else car.speed -= CAR_ACCEL * 0.55 * dt;
  } else {
    car.speed -= car.speed * 0.7 * dt;
  }
  car.speed = Math.max(-140, Math.min(CAR_TOP_SPEED, car.speed));

  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  const grip = brake ? 0.45 : 1;
  const turn = steer * (2.3 + 0.9 * speedRatio) * (car.speed >= 0 ? 1 : -1);
  car.angle += turn * Math.min(1, Math.abs(car.speed) / 90) * grip * dt;
  if (brake && Math.abs(car.speed) > 120) {
    car.speed -= car.speed * 0.35 * dt;
    G.skid.push({ x: car.x, y: car.y, angle: car.angle, life: 6 });
    if (G.skid.length > 400) G.skid.shift();
    if (Math.random() < dt * 8) burst(G, car.x, car.y, '#cbc3b2', 2, 60);
  }

  const prevX = car.x;
  const prevY = car.y;
  const moved = moveWithCollision(G, car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt);
  if (!moved && Math.abs(car.speed) > 200) {
    car.hp -= 8;
    car.speed *= -0.25;
    G.shake = Math.min(16, G.shake + 9);
    G.audio.crash(true);
    burst(G, car.x, car.y, '#e8e8e8', 12, 180);
    if (car.hp <= 0) G.busted('You wrecked your car.');
  } else if (!moved) {
    car.speed *= 0.5;
  }
  // Sideways scrape against a building still costs paint.
  if (moved && (Math.abs(car.x - prevX) < 0.01 && Math.abs(car.y - prevY) < 0.01) && Math.abs(car.speed) > 240) {
    car.hp -= 3;
  }
  G.player.x = car.x;
  G.player.y = car.y;
  G.player.angle = car.angle;
}

export function nearestCar(G, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    if (car.kind === 'traffic' || car.kind === 'police') continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}
