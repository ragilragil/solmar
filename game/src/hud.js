// Everything drawn on top of the world: the HUD (money, mission, wanted stars,
// health, minimap, speed, hints, message feed, banner) and the full-screen
// panels (title, pause, busted, wasted). The panels return their button
// rectangles so main.js can answer clicks on them.
import { TILE, WORLD_W, WORLD_H, MAX_WANTED, DAY_LENGTH } from './config.js';
import { missionInfo } from './missions.js';
import { weaponDef, weaponAmmo } from './weapons.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function font(size, weight) {
  return `${weight || 600} ${size}px ${FONT}`;
}

function panel(ctx, w, h, x, y, title, lines, prompt) {
  ctx.fillStyle = 'rgba(16, 18, 26, 0.88)';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = '#e8c33f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f2c94c';
  ctx.font = font(44, 800);
  ctx.fillText(title, x, y - h / 2 + 62);
  ctx.fillStyle = '#eef1f5';
  ctx.font = font(19);
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y - h / 2 + 116 + i * 30);
  });
  if (prompt) {
    ctx.fillStyle = '#e8c33f';
    ctx.font = font(20, 700);
    ctx.fillText(prompt, x, y + h / 2 - 26);
  }
}

function button(ctx, rect, label, active) {
  ctx.fillStyle = active ? '#e8c33f' : 'rgba(232, 195, 63, 0.16)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#e8c33f';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = active ? '#1c1e26' : '#e8c33f';
  ctx.font = font(20, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
}

export function titleButtons(w, h, hasSave) {
  const cx = w / 2;
  const list = [{ id: 'start', x: cx - 130, y: h / 2 + 96, w: 260, h: 52, label: 'START' }];
  if (hasSave) list.push({ id: 'continue', x: cx - 130, y: h / 2 + 158, w: 260, h: 52, label: 'CONTINUE' });
  list.push({ id: 'mute', x: cx - 130, y: h / 2 + (hasSave ? 220 : 158), w: 260, h: 52, label: 'SOUND: ON' });
  return list;
}

export function drawTitle(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(10, 12, 20, 0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c94c';
  ctx.font = font(84, 900);
  ctx.fillText('SOLMAR', w / 2, h / 2 - 148);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(24, 600);
  ctx.fillText('An open-world crime story', w / 2, h / 2 - 108);
  ctx.fillStyle = '#d8dce6';
  ctx.font = font(18);
  const story = [
    'You just got out. The city owes you, and Solmar pays in cash.',
    'Steal a car, run the package, lose the cops, rob the bank —',
    'and the whole sunny coast is yours.',
  ];
  story.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 - 66 + i * 26));
  const controls = 'WASD move · Shift run · E get in / out of a car · Space handbrake · F punch · G shoot · 1-4 weapons · R radio · M mute · Esc pause';
  ctx.fillStyle = '#9aa2b5';
  ctx.font = font(15);
  ctx.fillText(controls, w / 2, h / 2 + 22);
  const buttons = titleButtons(w, h, G.hasSave);
  for (const b of buttons) {
    button(ctx, b, b.id === 'mute' ? (G.audio.isMuted() ? 'SOUND: OFF' : 'SOUND: ON') : b.label, b.id === 'start');
  }
  ctx.fillStyle = '#9aa2b5';
  ctx.font = font(14);
  ctx.fillText('A complete open-world game, built for make.fun — no network, no files but this one.', w / 2, h - 22);
}

export function pauseButtons(w, h) {
  const cx = w / 2;
  return [
    { id: 'resume', x: cx - 130, y: h / 2 + 30, w: 260, h: 48, label: 'RESUME' },
    { id: 'restart', x: cx - 130, y: h / 2 + 88, w: 260, h: 48, label: 'RESTART' },
    { id: 'mute', x: cx - 130, y: h / 2 + 146, w: 260, h: 48, label: 'SOUND' },
    { id: 'quit', x: cx - 130, y: h / 2 + 204, w: 260, h: 48, label: 'SAVE & QUIT' },
  ];
}

export function drawPaused(ctx, G, w, h) {
  ctx.fillStyle = 'rgba(10, 12, 20, 0.6)';
  ctx.fillRect(0, 0, w, h);
  panel(ctx, 560, 420, w / 2, h / 2, 'PAUSED', ['The city waits for you.'], '');
  for (const b of pauseButtons(w, h)) {
    button(ctx, b, b.id === 'mute' ? (G.audio.isMuted() ? 'SOUND: OFF' : 'SOUND: ON') : b.label, b.id === 'resume');
  }
}

export function drawEnd(ctx, G, w, h, kind, reason) {
  ctx.fillStyle = 'rgba(10, 12, 20, 0.72)';
  ctx.fillRect(0, 0, w, h);
  const title = kind === 'busted' ? 'BUSTED' : 'WASTED';
  const color = kind === 'busted' ? '#6ab4f2' : '#e5534b';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = font(96, 900);
  ctx.fillText(title, w / 2, h / 2 - 20);
  ctx.fillStyle = '#eef1f5';
  ctx.font = font(22);
  ctx.fillText(reason || '', w / 2, h / 2 + 30);
  ctx.fillStyle = '#f2c94c';
  ctx.font = font(20, 700);
  ctx.fillText('Press Enter to continue', w / 2, h / 2 + 78);
}

function drawStars(ctx, x, y, wanted) {
  ctx.font = font(26, 800);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < MAX_WANTED; i += 1) {
    ctx.fillStyle = i < wanted ? '#f2c94c' : 'rgba(238, 241, 245, 0.25)';
    ctx.fillText('★', x + i * 30, y);
  }
}

function drawMinimap(ctx, G, w, h) {
  const mw = 196;
  const mh = 158;
  const x0 = w - mw - 16;
  const y0 = h - mh - 16;
  const sx = mw / WORLD_W;
  const sy = mh / WORLD_H;
  ctx.fillStyle = 'rgba(12, 14, 22, 0.78)';
  ctx.fillRect(x0 - 4, y0 - 4, mw + 8, mh + 8);
  ctx.fillStyle = '#1e7c99';
  ctx.fillRect(x0, y0 + 33 * TILE * sy, mw, mh - 33 * TILE * sy);
  ctx.fillStyle = '#e7d09b';
  ctx.fillRect(x0, y0 + 30 * TILE * sy, mw, 3 * TILE * sy);
  ctx.strokeStyle = 'rgba(238, 241, 245, 0.55)';
  ctx.lineWidth = 2;
  for (const vx of [5, 12, 19, 26, 33, 40]) {
    ctx.beginPath();
    ctx.moveTo(x0 + (vx * TILE + 48) * sx, y0);
    ctx.lineTo(x0 + (vx * TILE + 48) * sx, y0 + 30 * TILE * sy);
    ctx.stroke();
  }
  for (const hy of [5, 12, 19, 26]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + (hy * TILE + 48) * sy);
    ctx.lineTo(x0 + mw, y0 + (hy * TILE + 48) * sy);
    ctx.stroke();
  }
  const info = missionInfo(G);
  if (info.target) {
    const pulse = 5 + Math.sin(G.time * 5) * 2;
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(x0 + info.target.x * sx, y0 + info.target.y * sy - pulse - 3);
    ctx.lineTo(x0 + info.target.x * sx + pulse, y0 + info.target.y * sy);
    ctx.lineTo(x0 + info.target.x * sx, y0 + info.target.y * sy + pulse + 3);
    ctx.lineTo(x0 + info.target.x * sx - pulse, y0 + info.target.y * sy);
    ctx.closePath();
    ctx.fill();
  }
  for (const car of G.cars) {
    if (car.kind === 'police') {
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(x0 + car.x * sx - 2, y0 + car.y * sy - 2, 4, 4);
    }
  }
  ctx.fillStyle = '#ffffff';
  const px = x0 + G.player.x * sx;
  const py = y0 + G.player.y * sy;
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(G.player.angle) * 7, py + Math.sin(G.player.angle) * 7);
  ctx.lineTo(px + Math.cos(G.player.angle + 2.5) * 5, py + Math.sin(G.player.angle + 2.5) * 5);
  ctx.lineTo(px + Math.cos(G.player.angle - 2.5) * 5, py + Math.sin(G.player.angle - 2.5) * 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e8c33f';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 4, y0 - 4, mw + 8, mh + 8);
}

function clockText(G) {
  // The in-game clock starts at 14:00 and runs a full day in DAY_LENGTH
  // seconds, so one game hour is 20 seconds of play.
  const mins = (14 * 60 + G.time * 3) % (24 * 60);
  const hh = Math.floor(mins / 60);
  const mm = Math.floor(mins % 60);
  const phase = (G.time / DAY_LENGTH) % 1;
  const night = phase > 0.5 && phase < 0.88;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${night ? '☾' : '☀'}`;
}

export function drawHUD(ctx, G, w, h) {
  const info = missionInfo(G);
  ctx.textBaseline = 'alphabetic';
  // Top-left: money and the mission.
  ctx.fillStyle = 'rgba(12, 14, 22, 0.65)';
  ctx.fillRect(12, 12, 430, 66);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7ee787';
  ctx.font = font(26, 800);
  ctx.fillText(`$${G.player.money}`, 26, 42);
  ctx.fillStyle = '#f2c94c';
  ctx.font = font(16, 700);
  ctx.fillText(`${info.name.toUpperCase()}`, 108, 32);
  ctx.fillStyle = '#eef1f5';
  ctx.font = font(15);
  ctx.fillText(info.text, 108, 56);
  if (info.timer !== null && info.timer !== undefined) {
    ctx.fillStyle = info.timer < 15 ? '#ff6a5a' : '#eef1f5';
    ctx.font = font(22, 800);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(info.timer)}s`, 428, 46);
    ctx.textAlign = 'left';
  }
  // Top-right: wanted stars, health, clock, and the heat status — the
  // police are SEARCHING when no unit can see the player, which is when
  // the stars start to decay.
  ctx.fillStyle = 'rgba(12, 14, 22, 0.65)';
  ctx.fillRect(w - 268, 12, 256, 86);
  drawStars(ctx, w - 252, 42, G.wanted);
  ctx.fillStyle = '#eef1f5';
  ctx.font = font(15, 700);
  ctx.textAlign = 'right';
  ctx.fillText(clockText(G), w - 28, 42);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(w - 252, 54, 180, 12);
  ctx.fillStyle = G.player.hp > 40 ? '#7ee787' : '#ff6a5a';
  ctx.fillRect(w - 252, 54, 180 * Math.max(0, G.player.hp / 100), 12);
  ctx.fillStyle = '#eef1f5';
  ctx.font = font(13, 700);
  ctx.fillText('HP', w - 252, 52);
  // Right-aligned clear of the health bar (which ends at w - 72): the
  // old left-aligned spot sat on top of the bar's right end.
  ctx.textAlign = 'right';
  ctx.fillText(`AMMO ${weaponAmmo(G)}`, w - 28, 52);
  ctx.textAlign = 'left';
  if (G.wanted > 0) {
    const nearCop = G.cars.some((c) => c.kind === 'police' && Math.hypot(c.x - G.player.x, c.y - G.player.y) < 500);
    ctx.fillStyle = nearCop ? '#ff6a5a' : '#f2c94c';
    ctx.font = font(13, 700);
    ctx.fillText(nearCop ? 'ON THE RUN' : 'SEARCHING — stay hidden', w - 252, 84);
  }
  // Bottom-left: hints, speed, and the radio station. On foot the weapon
  // in hand is named here; in the air the box shows altitude and speed.
  ctx.fillStyle = 'rgba(12, 14, 22, 0.55)';
  ctx.fillRect(12, h - 84, 400, 72);
  ctx.fillStyle = '#c8ccd8';
  ctx.font = font(14);
  const wd = weaponDef(G.player.weapons.weapon);
  if (G.player.heli) {
    const heli = G.player.heli;
    ctx.fillText(`HELI  ALT ${Math.round(heli.alt)}  ·  SPEED ${Math.round(Math.abs(heli.speed) * 0.32)} km/h  ·  HP ${Math.round(heli.hp)}`, 24, h - 62);
    ctx.fillText('W/S fly · A/D turn · Space climb · Shift/C descend · E land & exit', 24, h - 42);
  } else if (G.player.plane) {
    const pl = G.player.plane;
    ctx.fillText(`PLANE  ALT ${Math.round(pl.alt)}  ·  SPEED ${Math.round(Math.abs(pl.speed) * 0.32)} km/h`, 24, h - 62);
    ctx.fillText('W throttle · A/D turn · Space climb · S descend · E land & exit', 24, h - 42);
  } else if (G.player.car) {
    const kmh = Math.round(Math.abs(G.player.car.speed) * 0.32);
    ctx.fillText(`SPEED ${kmh} km/h   ·   E exit car   ·   Space handbrake`, 24, h - 62);
    ctx.fillText('WASD drive   ·   M mute   ·   Esc pause', 24, h - 42);
  } else {
    ctx.fillText('WASD walk · Shift run · E enter car · F punch · G shoot', 24, h - 62);
    ctx.fillText(`${wd.name} ${weaponAmmo(G)}  ·  1-4 switch · Q cycle · M mute · Esc pause`, 24, h - 42);
  }
  ctx.fillStyle = '#f2c94c';
  ctx.fillText(`♫ ${G.audio.radioName()}   ·   R change station`, 24, h - 22);
  // Message feed, centre-top.
  ctx.textAlign = 'center';
  ctx.font = font(16, 600);
  const feed = G.feed.slice(-4);
  feed.forEach((msg, i) => {
    ctx.fillStyle = `rgba(238, 241, 245, ${1 - i * 0.22})`;
    ctx.fillText(msg, w / 2, 108 + i * 22);
  });
  // Mission banner.
  if (G.banner && G.banner.t > 0) {
    ctx.fillStyle = 'rgba(12, 14, 22, 0.8)';
    // Measure with the banner font itself: measuring with the feed's
    // smaller font made the box too narrow and the text overflowed it.
    ctx.font = font(24, 800);
    const bw = ctx.measureText(G.banner.text).width + 60;
    ctx.fillRect(w / 2 - bw / 2, 150, bw, 52);
    ctx.strokeStyle = '#e8c33f';
    ctx.lineWidth = 2;
    ctx.strokeRect(w / 2 - bw / 2, 150, bw, 52);
    ctx.fillStyle = '#f2c94c';
    ctx.fillText(G.banner.text, w / 2, 185);
  }
  drawMinimap(ctx, G, w, h);
}
