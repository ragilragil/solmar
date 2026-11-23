// SOLMAR's city: a seeded street grid with building blocks, a park, a taller
// downtown, docks on the east edge and a beach with turquoise sea along the
// south. The same seed always builds the same city. The module also answers
// the collision questions the rest of the game asks: is this point inside a
// building, in the water, or outside the world?
import {
  TILE, COLS, ROWS, WORLD_W, WORLD_H, V_ROADS, H_ROADS, ROAD_W,
  SAND_TOP, SEA_TOP, PALETTE,
} from './config.js';

// Block edges in tiles. Each road is two tiles wide, so a block runs from the
// end of one road to the start of the next: the pairs below are (start, end)
// of the seven column-blocks and five row-blocks. A block never covers a road.
const BLOCK_X = [0, 5, 7, 12, 14, 19, 21, 26, 28, 33, 35, 40, 42, COLS];
const BLOCK_Y = [0, 5, 7, 12, 14, 19, 21, 26, 28, 30];

function blockRect(bx, by) {
  return {
    x: BLOCK_X[bx * 2] * TILE,
    y: BLOCK_Y[by * 2] * TILE,
    w: (BLOCK_X[bx * 2 + 1] - BLOCK_X[bx * 2]) * TILE,
    h: (BLOCK_Y[by * 2 + 1] - BLOCK_Y[by * 2]) * TILE,
  };
}

export function createWorld(rng) {
  const buildings = [];
  const trees = [];
  const pickups = [];
  const containers = [];

  // The park is the middle block; the docks are the south-east block.
  const park = blockRect(2, 2);
  const docks = blockRect(6, 4);

  const downtown = (bx, by) => bx >= 2 && bx <= 4 && by <= 1;

  function addBuilding(rect, kind, tall) {
    const palette = tall ? PALETTE.downtown : PALETTE.building;
    const color = rng.pick(palette);
    const roof = rng.pick(PALETTE.roof);
    buildings.push({
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      color, roof, tall: !!tall, kind: kind || 'normal',
    });
    return buildings[buildings.length - 1];
  }

  // One building per special block, placed by hand so the missions have fixed
  // doors to aim at.
  const hospitalRect = { x: 1 * TILE, y: 1 * TILE, w: 3 * TILE, h: 3 * TILE };
  addBuilding(hospitalRect, 'hospital', false);
  const garageRect = { x: 8 * TILE, y: 15 * TILE, w: 3 * TILE, h: 2 * TILE };
  addBuilding(garageRect, 'garage', false);
  const bankRect = { x: 22 * TILE, y: 1 * TILE, w: 3 * TILE, h: 3 * TILE };
  addBuilding(bankRect, 'bank', true);
  const houseRect = { x: 1 * TILE, y: 22 * TILE, w: 2 * TILE, h: 2 * TILE };
  addBuilding(houseRect, 'house', false);

  // Every other block gets one to three buildings, with a sidewalk margin.
  // Seven column-blocks, five row-blocks.
  for (let bx = 0; bx < 7; bx += 1) {
    for (let by = 0; by < 5; by += 1) {
      const rect = blockRect(bx, by);
      const special = (bx === 0 && by === 0) || (bx === 1 && by === 2)
        || (bx === 3 && by === 0) || (bx === 0 && by === 3)
        || (bx === 2 && by === 2) || (bx === 6 && by === 4);
      if (special) continue;
      const count = rng.int(1, 3);
      const tall = downtown(bx, by);
      for (let i = 0; i < count; i += 1) {
        const margin = TILE * 0.6;
        const bw = rng.range(TILE * 1.2, Math.max(TILE * 1.3, rect.w - margin * 2));
        const bh = rng.range(TILE * 1.2, Math.max(TILE * 1.3, rect.h - margin * 2));
        const bx0 = rect.x + margin + rng.range(0, Math.max(0, rect.w - margin * 2 - bw));
        const by0 = rect.y + margin + rng.range(0, Math.max(0, rect.h - margin * 2 - bh));
        const candidate = { x: bx0, y: by0, w: bw, h: bh };
        const overlaps = buildings.some((b) => (
          candidate.x < b.x + b.w + 12 && candidate.x + candidate.w + 12 > b.x
          && candidate.y < b.y + b.h + 12 && candidate.y + candidate.h + 12 > b.y
        ));
        if (!overlaps) addBuilding(candidate, 'normal', tall);
      }
      // A street tree or two on the block's sidewalk.
      if (rng.next() < 0.6) {
        trees.push({
          x: rect.x + rng.range(TILE, rect.w - TILE),
          y: rect.y + rng.range(TILE, rect.h - TILE),
          palm: false,
        });
      }
    }
  }

  // Park trees, and palms along the sand.
  for (let i = 0; i < 14; i += 1) {
    trees.push({
      x: park.x + rng.range(TILE * 0.5, park.w - TILE * 0.5),
      y: park.y + rng.range(TILE * 0.5, park.h - TILE * 0.5),
      palm: false,
    });
  }
  for (let i = 0; i < 12; i += 1) {
    trees.push({
      x: rng.range(TILE, WORLD_W - TILE),
      y: SAND_TOP + rng.range(TILE * 0.4, TILE * 2.2),
      palm: true,
    });
  }

  // Shipping containers in the docks yard.
  for (let i = 0; i < 6; i += 1) {
    containers.push({
      x: docks.x + TILE * 0.4 + (i % 3) * TILE * 1.1,
      y: docks.y + TILE * 0.3 + Math.floor(i / 3) * TILE * 0.9,
      w: TILE * 0.9, h: TILE * 0.6,
      color: rng.pick(['#c96a4a', '#4a7ac9', '#5aa84f', '#c9a44a']),
    });
  }

  // Health and ammo pickups on sidewalks near intersections.
  const spots = [];
  for (const vx of V_ROADS) {
    for (const hy of H_ROADS) {
      spots.push({ x: vx * TILE + ROAD_W + TILE * 0.5, y: hy * TILE - TILE * 0.5 });
      spots.push({ x: vx * TILE - TILE * 0.5, y: hy * TILE + ROAD_W + TILE * 0.5 });
    }
  }
  for (let i = 0; i < 16; i += 1) {
    const spot = spots[rng.int(0, spots.length - 1)];
    pickups.push({
      x: spot.x, y: spot.y,
      kind: i % 2 === 0 ? 'health' : 'ammo',
      taken: false, respawn: 0,
    });
  }

  const intersections = [];
  for (let i = 0; i < V_ROADS.length; i += 1) {
    for (let j = 0; j < H_ROADS.length; j += 1) {
      intersections.push({
        x: V_ROADS[i] * TILE + ROAD_W / 2,
        y: H_ROADS[j] * TILE + ROAD_W / 2,
        i, j,
      });
    }
  }

  const places = {
    hospital: { x: hospitalRect.x + hospitalRect.w / 2, y: hospitalRect.y + hospitalRect.h + TILE * 0.7 },
    garage: { x: garageRect.x + garageRect.w + TILE * 0.7, y: garageRect.y + garageRect.h / 2 },
    bank: { x: bankRect.x + bankRect.w / 2, y: bankRect.y + bankRect.h + TILE * 0.7 },
    safehouse: { x: houseRect.x + houseRect.w / 2, y: houseRect.y + houseRect.h + TILE * 0.7 },
    docks: { x: docks.x + docks.w / 2, y: docks.y + docks.h / 2 },
    pickup: { x: 30.5 * TILE, y: 9.5 * TILE },
    beach: { x: 20 * TILE, y: 31 * TILE },
  };

  return { buildings, trees, pickups, containers, park, docks, places, intersections };
}

// Circle (x, y, radius r) against every building rectangle.
export function hitsBuilding(world, x, y, r) {
  for (const b of world.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
  }
  return false;
}

export function inWater(world, x, y) {
  return y >= SEA_TOP || x < 0 || x > WORLD_W || y < 0 || y > WORLD_H;
}

// Anything solid a walker or a car cannot enter.
export function blocked(world, x, y, r) {
  if (x - r < 0 || x + r > WORLD_W || y - r < 0 || y + r > WORLD_H) return true;
  if (y + r >= SEA_TOP) return true;
  return hitsBuilding(world, x, y, r);
}

// The nearest point on the road network to (x, y): used for the GPS line.
export function nearestRoadPoint(x, y) {
  let bestX = V_ROADS[0] * TILE + ROAD_W / 2;
  let bestDx = Math.abs(x - bestX);
  for (const vx of V_ROADS) {
    const cx = vx * TILE + ROAD_W / 2;
    if (Math.abs(x - cx) < bestDx) {
      bestDx = Math.abs(x - cx);
      bestX = cx;
    }
  }
  let bestY = H_ROADS[0] * TILE + ROAD_W / 2;
  let bestDy = Math.abs(y - bestY);
  for (const hy of H_ROADS) {
    const cy = hy * TILE + ROAD_W / 2;
    if (Math.abs(y - cy) < bestDy) {
      bestDy = Math.abs(y - cy);
      bestY = cy;
    }
  }
  return { roadX: bestX, roadY: bestY };
}
