// SOLMAR's arsenal: four original weapons, each with its own feel.
// The player starts with the P9 sidearm; the other three are found in
// weapon crates around the city (docks, park, helipad, downtown) and stay
// owned once picked up. Ammo comes from the yellow ammo boxes, which feed
// whatever weapon is in hand.
import { PISTOL_AMMO } from './config.js';
import { fleePeds } from './cars.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', damage: 20, cooldown: 0.25, pellets: 1, spread: 0.02,
    bulletSpeed: 720, bulletLife: 1.2, auto: false, maxAmmo: 60,
    startAmmo: PISTOL_AMMO, sound: 'shot', explosive: false, blast: 0,
  },
  shotgun: {
    name: 'S12 Scattergun', damage: 14, cooldown: 0.85, pellets: 6, spread: 0.38,
    bulletSpeed: 640, bulletLife: 0.55, auto: false, maxAmmo: 30,
    startAmmo: 0, sound: 'shotgun', explosive: false, blast: 0,
  },
  rifle: {
    name: 'AR-7 Storm', damage: 26, cooldown: 0.12, pellets: 1, spread: 0.05,
    bulletSpeed: 900, bulletLife: 1.4, auto: true, maxAmmo: 120,
    startAmmo: 0, sound: 'shot', explosive: false, blast: 0,
  },
  rocket: {
    name: 'RL-9 Boomer', damage: 90, cooldown: 1.4, pellets: 1, spread: 0,
    bulletSpeed: 380, bulletLife: 2.2, auto: false, maxAmmo: 8,
    startAmmo: 0, sound: 'rocket', explosive: true, blast: 120,
  },
};

export const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle', 'rocket'];

export function createWeaponState() {
  const ammo = {};
  const owned = {};
  for (const id of WEAPON_ORDER) {
    ammo[id] = WEAPONS[id].startAmmo;
    owned[id] = id === 'pistol';
  }
  return { weapon: 'pistol', ammo, owned };
}

export function weaponDef(id) {
  return WEAPONS[id] || WEAPONS.pistol;
}

export function weaponAmmo(G) {
  return G.player.weapons.ammo[G.player.weapons.weapon] || 0;
}

export function addAmmo(G, n) {
  const w = G.player.weapons;
  const def = weaponDef(w.weapon);
  w.ammo[w.weapon] = Math.min(def.maxAmmo, (w.ammo[w.weapon] || 0) + n);
}

export function giveWeapon(G, id, ammo) {
  const w = G.player.weapons;
  const def = weaponDef(id);
  w.owned[id] = true;
  w.ammo[id] = Math.min(def.maxAmmo, (w.ammo[id] || 0) + (ammo || 0));
  w.weapon = id;
  G.feed.push(`Picked up the ${def.name}!`);
  G.audio.pickup();
}

export function switchWeapon(G, id) {
  const w = G.player.weapons;
  if (!w.owned[id]) {
    G.feed.push(`You have not found the ${weaponDef(id).name} yet.`);
    return;
  }
  if (w.weapon === id) return;
  w.weapon = id;
  G.feed.push(`${weaponDef(id).name} — ${w.ammo[id]} rounds`);
}

export function cycleWeapon(G) {
  const w = G.player.weapons;
  const owned = WEAPON_ORDER.filter((id) => w.owned[id]);
  if (owned.length < 2) return;
  const idx = owned.indexOf(w.weapon);
  const next = owned[(idx + 1) % owned.length];
  switchWeapon(G, next);
}

function fireOne(G, angle, def) {
  const p = G.player;
  for (let i = 0; i < def.pellets; i += 1) {
    const spread = (Math.random() - 0.5) * 2 * def.spread;
    G.bullets.push({
      x: p.x + Math.cos(angle) * 22,
      y: p.y + Math.sin(angle) * 22,
      angle: angle + spread,
      life: def.bulletLife,
      speed: def.bulletSpeed,
      dmg: def.damage,
      explosive: def.explosive,
      blast: def.blast,
      big: def.explosive,
    });
  }
}

// Fire the weapon in hand. Semi-automatic weapons fire once per press or
// click; the rifle keeps firing while G is held. Shooting on foot only —
// the player cannot shoot from a car, a helicopter or a plane.
export function fireWeapon(G, input) {
  const p = G.player;
  if (p.shootCd > 0) return;
  if (p.car || p.heli || p.plane) return;
  const w = p.weapons;
  const def = weaponDef(w.weapon);
  const held = input.down('KeyG');
  const pressed = input.pressed('KeyG') || input.clickedRight();
  if (def.auto ? !held && !pressed : !pressed) return;
  if ((w.ammo[w.weapon] || 0) <= 0) {
    p.shootCd = 0.4;
    G.feed.push(`No ammo for the ${def.name} — find a yellow ammo box.`);
    return;
  }
  p.shootCd = def.cooldown;
  w.ammo[w.weapon] -= 1;
  const aim = G.aim || { x: p.x + Math.cos(p.angle) * 120, y: p.y + Math.sin(p.angle) * 120 };
  const angle = Math.atan2(aim.y - p.y, aim.x - p.x);
  fireOne(G, angle, def);
  if (def.sound === 'shotgun') G.audio.shotgun();
  else if (def.sound === 'rocket') G.audio.rocket();
  else G.audio.shot();
  G.shake = Math.min(12, G.shake + (def.explosive ? 6 : def.pellets > 1 ? 4 : 2));
  // The fleeing pedestrians are the city's way of noticing gunfire.
  fleePeds(G, p.x, p.y, 320);
  if (p.shootWantedCd <= 0) {
    p.shootWantedCd = 1.5;
    G.addWanted(2);
  }
}

// Weapon crates: fixed spots the player can walk over to unlock a weapon.
// They respawn after 25 seconds, so a spent rocket launcher comes back.
export function createWeaponPickups() {
  return [
    { x: 2040, y: 1380, kind: 'shotgun', taken: false, respawn: 0 },
    { x: 504, y: 840, kind: 'rifle', taken: false, respawn: 0 },
    { x: 1850, y: 1470, kind: 'rocket', taken: false, respawn: 0 },
    // On the sidewalk by the safehouse — clear of the screenshot routes,
    // so it never reads as junk lying in the road.
    { x: 240, y: 1056, kind: 'shotgun', taken: false, respawn: 0 },
  ];
}

export function updateWeaponPickups(G, dt) {
  const p = G.player;
  for (const pickup of G.weaponPickups) {
    if (pickup.taken) {
      pickup.respawn -= dt;
      if (pickup.respawn <= 0) pickup.taken = false;
      continue;
    }
    if (!p.onFoot) continue;
    if (Math.hypot(pickup.x - p.x, pickup.y - p.y) < 30) {
      pickup.taken = true;
      pickup.respawn = 25;
      const def = weaponDef(pickup.kind);
      const already = p.weapons.owned[pickup.kind];
      const bonus = pickup.kind === 'rocket' ? 2 : pickup.kind === 'shotgun' ? 6 : 30;
      giveWeapon(G, pickup.kind, bonus);
      if (already) G.feed.push(`${def.name} restocked +${bonus}`);
    }
  }
}
