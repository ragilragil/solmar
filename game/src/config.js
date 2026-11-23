// SOLMAR tuning: world size, road layout, palette and gameplay numbers.
// All distances are world pixels; one tile is 48 px.
export const TILE = 48;
export const COLS = 44;
export const ROWS = 36;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

// Roads are two tiles wide. The numbers are the left/top tile of each road.
// Vertical roads run the full height, horizontal roads the full width.
export const V_ROADS = [5, 12, 19, 26, 33, 40];
export const H_ROADS = [5, 12, 19, 26];
export const ROAD_W = TILE * 2;

// The last six rows are the beach: sand, then sea. Nobody drives into the sea.
export const SAND_TOP = 30 * TILE;
export const SEA_TOP = 33 * TILE;

export const SAVE_KEY = 'solmar-save-v1';

// A sun-soaked coastal city: warm sand, turquoise sea, pastel buildings.
export const PALETTE = {
  grass: '#7cab60',
  sidewalk: '#cbc3b2',
  asphalt: '#413d47',
  asphaltEdge: '#2e2b33',
  lane: '#e8d44d',
  sand: '#e7d09b',
  sea: '#2f9db8',
  seaDeep: '#1e7c99',
  park: '#5d9c4c',
  pier: '#8a6f4d',
  building: ['#e8a3a3', '#f2c48d', '#a9c9e8', '#b6d9a0', '#e8d8a0', '#d9a1c9', '#a1d8d0', '#e8b48d'],
  roof: ['#b87d7d', '#c79a62', '#7fa8c8', '#8fb87a', '#c8b06a', '#b87aa8', '#7ab8b0', '#c8926a'],
  downtown: ['#c9a3d9', '#8db4d9', '#d9b48d', '#9ec9b0'],
  car: ['#d94f4f', '#4f7ed9', '#e8c33f', '#4fd94f', '#d94fd9', '#e8e8e8', '#3a3a3a', '#e8862f', '#2f9db8', '#e8a3a3', '#8a6f4d', '#7a5fd9'],
  ped: ['#e86a6a', '#6a9ae8', '#6ad96a', '#e8d06a', '#c96ad9', '#6ad9d2', '#e8e8e8'],
};

export const DAY_LENGTH = 480; // one full day/night cycle, in seconds of play

export const WALK_SPEED = 175;
export const RUN_SPEED = 265;
export const CAR_TOP_SPEED = 430;
export const CAR_ACCEL = 320;
export const CAR_BRAKE = 520;
export const POLICE_TOP_SPEED = 400;
export const TRAFFIC_SPEED = 150;
export const BULLET_SPEED = 720;
export const PUNCH_RANGE = 58;
export const PISTOL_AMMO = 12;
export const MAX_WANTED = 5;
export const CRIME_QUIET_SECONDS = 15;
export const WANTED_DECAY_SECONDS = 8;
export const BUSTED_HOLD_SECONDS = 2;
