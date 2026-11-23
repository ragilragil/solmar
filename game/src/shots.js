// The screenshot scenes behind ?shot=start|drive|foot|chase. Each one sets the
// real game to a fixed situation — a real car, real police, a real mission
// with its GPS line — then plays it forward for a couple of seconds with no
// input, so the frame is what a short session really looks like and the same
// seed always gives the same frame.
import { TILE, ROAD_W, V_ROADS, H_ROADS } from './config.js';
import { setMission } from './missions.js';
import { spawnPoliceCar, spawnRoadblock, makeCar } from './cars.js';
import { spawnPoliceHeli } from './aircraft.js';
import { giveWeapon } from './weapons.js';

function putPlayerInCar(G, x, y, angle, color) {
  const car = makeCar(x, y, angle, color || '#d94f4f', 'player');
  car.speed = 0;
  G.cars.push(car);
  G.player.car = car;
  G.player.onFoot = false;
  G.player.x = x;
  G.player.y = y;
  G.player.angle = angle;
  return car;
}

export function stageShot(G, name) {
  const places = G.world.places;
  // The welcome line is the first thing a new player sees, but it is
  // stale by the time a screenshot is taken — drop it from the feed so
  // every shot shows only what is happening in the frame.
  const dropWelcome = () => {
    G.feed = G.feed.filter((m) => !m.startsWith('Welcome to Solmar'));
  };
  // Keep pedestrians on the sidewalks for a shot's 1.5 s play-forward:
  // a ped that reaches its target mid-shot may cross the road on a
  // crosswalk and get run over in frame, so every ped is sent back to
  // its own sidewalk first and then along it — never across the road.
  const keepPedsOnSidewalk = () => {
    for (const ped of G.peds) {
      if (!ped.road) continue;
      if (ped.road.type === 'v') {
        ped.tx = V_ROADS[ped.road.idx] * TILE + (ped.road.side < 0 ? -TILE * 0.6 : ROAD_W + TILE * 0.6);
        ped.ty = ped.y + 300;
      } else {
        ped.tx = ped.x + 300;
        ped.ty = H_ROADS[ped.road.idx] * TILE + (ped.road.side < 0 ? -TILE * 0.6 : ROAD_W + TILE * 0.6);
      }
      ped.state = 'walk';
      ped.timer = 0;
    }
  };
  if (name === 'drive') {
    G.state = 'playing';
    // On the east-west road through downtown, heading east toward the docks.
    const car = putPlayerInCar(G, 16 * TILE, 12 * TILE + 48, 0, '#d94f4f');
    car.speed = 300;
    G.wanted = 2;
    G.crimeT = 0;
    setMission(G, 1);
    G.missions.stage = 'deliver';
    G.missions.timer = 82;
    for (let i = 0; i < 2; i += 1) {
      const cop = spawnPoliceCar(G);
      cop.x = car.x - 260 - i * 90;
      cop.y = car.y + (i === 0 ? -40 : 40);
      cop.angle = 0;
      cop.speed = 320;
    }
    // One more police car coming the other way, so the chase is in frame:
    // the chase camera only sees what is ahead of the player's car.
    const oncoming = spawnPoliceCar(G);
    oncoming.x = car.x + 430;
    oncoming.y = car.y - 24;
    oncoming.angle = Math.PI;
    oncoming.speed = 330;
    // An airliner crossing the sky ahead of the car, so the drive shot's
    // sky is not empty blue: it starts far ahead and to the south (the
    // left of the frame), low enough to sit in the camera's narrow sky
    // band, and drifts east while the car closes on it.
    const liner = G.planes[0];
    liner.x = car.x + 800;
    liner.y = car.y + 180;
    liner.alt = 150;
    liner.angle = 0.12;
    liner.speed = 180;
    keepPedsOnSidewalk();
    G.camera.x = car.x + 120;
    G.camera.y = car.y;
    G.camera.zoom = 0.9;
    dropWelcome();
    return;
  }
  if (name === 'foot') {
    G.state = 'playing';
    G.player.x = places.beach.x;
    G.player.y = places.beach.y;
    G.player.onFoot = true;
    G.player.car = null;
    // Face the sea: the chase camera sits behind the player, so the frame
    // gets the sand, the palms and the turquoise water, not just the city.
    G.player.angle = Math.PI / 2;
    setMission(G, 0);
    G.missions.stage = 'steal';
    // A few pedestrians strolling the sand, and a parked car to steal nearby.
    // Kept 120-320 units to the sides, so nobody stands right on the player
    // and looms over the camera.
    for (const ped of G.peds) {
      const side = Math.random() < 0.5 ? -1 : 1;
      ped.x = places.beach.x + side * (120 + Math.random() * 200);
      ped.y = places.beach.y + (Math.random() - 0.5) * 160;
      ped.state = 'walk';
    }
    const parked = makeCar(places.beach.x + 260, 29 * TILE + 24, Math.PI / 2, '#4f7ed9', 'parked');
    G.cars.push(parked);
    // A weapon in hand: the player holds the rocket launcher (the HUD names
    // it), but nothing is fired — the beach stays clean, nobody is hurt,
    // and the feed never says "You shot a pedestrian!".
    giveWeapon(G, 'rocket', 2);
    // Four stars with the police helicopter circling overhead: the heat and
    // the chopper are in the frame without any crime in the shot itself.
    // (The chopper only stays up while the heat is on, so the stars are
    // part of the staging, not an accident of the play-forward.)
    G.wanted = 4;
    G.crimeT = 0;
    spawnPoliceHeli(G);
    G.camera.x = places.beach.x;
    G.camera.y = places.beach.y - 40;
    G.camera.zoom = 1;
    dropWelcome();
    return;
  }
  if (name === 'chase') {
    G.state = 'playing';
    // South down the long avenue through the middle of the city, so the car
    // is still among the buildings when the frame is taken.
    const car = putPlayerInCar(G, 19 * TILE + 48, 14 * TILE, Math.PI / 2, '#e8c33f');
    car.speed = 380;
    G.wanted = 5;
    G.crimeT = 0;
    setMission(G, 2);
    G.missions.stage = 'survive';
    G.missions.started = true;
    G.missions.timer = 18;
    G.banner = { text: 'MISSION COMPLETE: Package Run  +$500', t: 3.5 };
    for (let i = 0; i < 3; i += 1) {
      const cop = spawnPoliceCar(G);
      // Flanking the player car instead of trailing far behind it: the
      // chase camera only sees what is near the player, so a cop 300 units
      // back is off-screen and the chase reads as empty road.
      cop.x = car.x - 40 - i * 30;
      cop.y = car.y + (i === 0 ? -75 : i === 1 ? 75 : -140);
      cop.angle = Math.PI / 2;
      cop.speed = 360;
    }
    // A roadblock across the cross street just ahead-left, in frame at the
    // shutter (the player reaches it a moment after the shot is taken):
    // it shows the new 5-star police behaviour without the player smashing
    // into it during the shot's 1.5 s play-forward. Kept 96 units off the
    // player's line, so the ram check (46 units) never trips mid-shot.
    spawnRoadblock(G, 22 * TILE, 26 * TILE + 48, 0);
    // The police helicopter starts ahead of the car and stays in front
    // through the play-forward, so the chopper is in the frame.
    spawnPoliceHeli(G);
    G.camera.x = car.x;
    G.camera.y = car.y + 100;
    G.camera.zoom = 0.88;
    keepPedsOnSidewalk();
    dropWelcome();
    return;
  }
  // start (and anything else): the title over a living downtown.
  G.state = 'title';
  G.camera.x = 22 * TILE;
  G.camera.y = 10 * TILE;
  G.camera.zoom = 0.9;
  // A living street for the title: a few traffic cars rolling down the
  // middle avenue toward the sea, and pedestrians on its sidewalks, so
  // the road in frame is busy instead of empty. The title camera drifts
  // down this avenue, so the cars and walkers stay in view.
  const avenueX = 19 * TILE + 48;
  const southNode = G.world.intersections.find((n) => n.i === 2 && n.j === 2);
  const nextNode = G.world.intersections.find((n) => n.i === 2 && n.j === 3);
  const traffic = G.cars.filter((c) => c.kind === 'traffic');
  for (let i = 0; i < 4 && i < traffic.length; i += 1) {
    const car = traffic[i];
    car.node = southNode;
    car.fromNode = southNode;
    car.targetNode = nextNode;
    car.laneX = -24;
    car.laneY = 0;
    car.x = avenueX - 24;
    car.y = 900 + i * 120;
    car.angle = Math.PI / 2;
    car.speed = 150;
  }
  for (let i = 0; i < 6 && i < G.peds.length; i += 1) {
    const ped = G.peds[i];
    const side = i % 2 === 0 ? -1 : 1;
    ped.x = side < 0 ? 19 * TILE - TILE * 0.6 : 19 * TILE + ROAD_W + TILE * 0.6;
    ped.y = 880 + i * 95;
    ped.tx = ped.x;
    ped.ty = ped.y + (side > 0 ? 220 : -220);
    ped.road = { type: 'v', idx: 2, side };
    ped.state = 'walk';
    ped.angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  dropWelcome();
}
