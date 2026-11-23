// Drawing only: the city, the cars, the people and the effects, as seen
// through the follow camera. Everything is flat canvas shapes — no images —
// so the game is a handful of files and still looks like a sun-soaked city.
import {
  TILE, WORLD_W, WORLD_H, V_ROADS, H_ROADS, ROAD_W,
  SAND_TOP, SEA_TOP, PALETTE,
} from './config.js';
import { nearestRoadPoint } from './world.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCarShape(ctx, car, isPlayer, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  roundRect(ctx, -21, -9, 46, 26, 8);
  ctx.fill();
  ctx.fillStyle = car.color;
  roundRect(ctx, -23, -12, 46, 24, 7);
  ctx.fill();
  if (car.kind === 'police') {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(-6, -12, 14, 24);
  }
  ctx.fillStyle = '#1c2733';
  ctx.fillRect(-8, -9, 12, 18);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(-8, -9, 12, 4);
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(23, -8, 2.5, 0, Math.PI * 2);
  ctx.arc(23, 8, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(-24, -8, 2, 4);
  ctx.fillRect(-24, 4, 2, 4);
  if (car.kind === 'police') {
    const flash = Math.floor(time * 4) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3b30' : '#3b82ff';
    ctx.fillRect(-2, -12, 8, 5);
    ctx.fillStyle = flash ? '#3b82ff' : '#ff3b30';
    ctx.fillRect(-2, 7, 8, 5);
  }
  if (isPlayer) {
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 2;
    roundRect(ctx, -25, -14, 50, 28, 9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPedShape(ctx, ped, time) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  if (ped.state === 'down') {
    ctx.rotate(ped.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 9, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const bob = Math.sin(time * 9 + ped.x) * 1.5;
  ctx.fillStyle = ped.color;
  ctx.beginPath();
  ctx.arc(0, 2 + bob, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8b98d';
  ctx.beginPath();
  ctx.arc(0, -7 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBuilding(ctx, b, time) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
  ctx.fillStyle = b.color;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = b.roof;
  ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
  // Windows: a lit grid on tall buildings, a few on low ones.
  ctx.fillStyle = 'rgba(28, 39, 51, 0.55)';
  const cols = Math.max(1, Math.floor(b.w / 26));
  const rows = Math.max(1, Math.floor(b.h / 26));
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      if (b.tall || (i + j) % 2 === 0) {
        ctx.fillRect(b.x + 10 + i * 26, b.y + 10 + j * 26, 12, 14);
      }
    }
  }
  if (b.kind === 'hospital') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x + b.w / 2 - 4, b.y + b.h / 2 - 16, 8, 32);
    ctx.fillRect(b.x + b.w / 2 - 16, b.y + b.h / 2 - 4, 32, 8);
    ctx.fillStyle = '#e5534b';
    ctx.fillRect(b.x + b.w / 2 - 3, b.y + b.h / 2 - 12, 6, 24);
    ctx.fillRect(b.x + b.w / 2 - 12, b.y + b.h / 2 - 3, 24, 6);
  }
  if (b.kind === 'bank') {
    ctx.fillStyle = '#f2e8c9';
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(b.x + 12 + i * (b.w - 24) / 3, b.y + b.h - 22, 8, 22);
    }
  }
  if (b.kind === 'garage') {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(b.x + b.w - 18, b.y + 10, 12, b.h - 20);
    ctx.fillStyle = '#e8c33f';
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('GARAGE', b.x + b.w / 2, b.y + 18);
  }
  if (b.kind === 'house') {
    ctx.fillStyle = '#b8543f';
    ctx.beginPath();
    ctx.moveTo(b.x - 4, b.y + 6);
    ctx.lineTo(b.x + b.w / 2, b.y - 16);
    ctx.lineTo(b.x + b.w + 4, b.y + 6);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTree(ctx, t, time) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 4, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (t.palm) {
    ctx.strokeStyle = '#8a6f4d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y + 8);
    ctx.quadraticCurveTo(t.x + 3, t.y - 6, t.x + 6, t.y - 14);
    ctx.stroke();
    ctx.strokeStyle = '#3f8f3a';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI * 0.15 - i * 0.55 + Math.sin(time + t.x) * 0.05;
      ctx.beginPath();
      ctx.moveTo(t.x + 6, t.y - 14);
      ctx.quadraticCurveTo(t.x + 6 + Math.cos(a) * 12, t.y - 14 + Math.sin(a) * 8, t.x + 6 + Math.cos(a) * 20, t.y - 14 + Math.sin(a) * 14);
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = '#6f4f2f';
  ctx.fillRect(t.x - 2, t.y - 2, 4, 10);
  ctx.fillStyle = '#4d8f3d';
  ctx.beginPath();
  ctx.arc(t.x, t.y - 8, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5da34e';
  ctx.beginPath();
  ctx.arc(t.x - 5, t.y - 12, 8, 0, Math.PI * 2);
  ctx.fill();
}

export function drawWorld(ctx, G, w, h) {
  const cam = G.camera;
  const shakeX = (Math.random() - 0.5) * G.shake;
  const shakeY = (Math.random() - 0.5) * G.shake;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x + shakeX, -cam.y + shakeY);

  // Ground, beach and sea.
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, SAND_TOP, WORLD_W, SEA_TOP - SAND_TOP);
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(0, SEA_TOP, WORLD_W, WORLD_H - SEA_TOP);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i += 1) {
    const wy = SEA_TOP + 18 + i * 22;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 48) {
      const y = wy + Math.sin(x / 90 + G.time * 1.4 + i) * 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Sidewalk blocks, then the park and the docks yard.
  ctx.fillStyle = PALETTE.sidewalk;
  const bxEdges = [0, 7, 14, 21, 28, 35, 42, 44];
  const byEdges = [0, 7, 14, 21, 28, 30];
  for (let i = 0; i < bxEdges.length - 1; i += 1) {
    for (let j = 0; j < byEdges.length - 1; j += 1) {
      ctx.fillRect(bxEdges[i] * TILE, byEdges[j] * TILE, (bxEdges[i + 1] - bxEdges[i]) * TILE, (byEdges[j + 1] - byEdges[j]) * TILE);
    }
  }
  ctx.fillStyle = PALETTE.park;
  ctx.fillRect(G.world.park.x, G.world.park.y, G.world.park.w, G.world.park.h);
  ctx.fillStyle = '#7ec8e8';
  ctx.beginPath();
  ctx.ellipse(G.world.park.x + G.world.park.w / 2, G.world.park.y + G.world.park.h / 2, 34, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9a938a';
  ctx.fillRect(G.world.docks.x, G.world.docks.y, G.world.docks.w, G.world.docks.h);
  ctx.fillStyle = PALETTE.pier;
  ctx.fillRect(G.world.docks.x + G.world.docks.w - 14, G.world.docks.y, 14, G.world.docks.h);
  for (const c of G.world.containers) {
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(c.x, c.y, c.w, 5);
  }

  // Roads: asphalt, edge lines, centre dashes, crosswalks.
  ctx.fillStyle = PALETTE.asphalt;
  for (const vx of V_ROADS) ctx.fillRect(vx * TILE, 0, ROAD_W, SAND_TOP);
  for (const hy of H_ROADS) ctx.fillRect(0, hy * TILE, WORLD_W, ROAD_W);
  ctx.strokeStyle = PALETTE.asphaltEdge;
  ctx.lineWidth = 2;
  for (const vx of V_ROADS) {
    ctx.strokeRect(vx * TILE, 0, ROAD_W, SAND_TOP);
  }
  for (const hy of H_ROADS) {
    ctx.strokeRect(0, hy * TILE, WORLD_W, ROAD_W);
  }
  ctx.fillStyle = PALETTE.lane;
  for (const vx of V_ROADS) {
    const cx = vx * TILE + ROAD_W / 2;
    for (let y = 12; y < SAND_TOP - 12; y += 44) ctx.fillRect(cx - 2, y, 4, 24);
  }
  for (const hy of H_ROADS) {
    const cy = hy * TILE + ROAD_W / 2;
    for (let x = 12; x < WORLD_W - 12; x += 44) ctx.fillRect(x, cy - 2, 24, 4);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (const n of G.world.intersections) {
    for (let i = -2; i <= 2; i += 1) {
      ctx.fillRect(n.x - 34 + i * 14, n.y - ROAD_W / 2 - 8, 7, 16);
      ctx.fillRect(n.x - ROAD_W / 2 - 8, n.y - 34 + i * 14, 16, 7);
    }
  }

  // Buildings, trees, pickups, skid marks.
  for (const b of G.world.buildings) drawBuilding(ctx, b, G.time);
  for (const t of G.world.trees) drawTree(ctx, t, G.time);
  for (const pickup of G.world.pickups) {
    if (pickup.taken) continue;
    const bob = Math.sin(G.time * 3 + pickup.x) * 2;
    if (pickup.kind === 'health') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(pickup.x - 10, pickup.y - 10 + bob, 20, 20);
      ctx.fillStyle = '#37b24d';
      ctx.fillRect(pickup.x - 3, pickup.y - 8 + bob, 6, 16);
      ctx.fillRect(pickup.x - 8, pickup.y - 3 + bob, 16, 6);
    } else {
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(pickup.x - 10, pickup.y - 8 + bob, 20, 16);
      ctx.fillStyle = '#1c1e26';
      ctx.fillRect(pickup.x - 6, pickup.y - 4 + bob, 4, 8);
      ctx.fillRect(pickup.x, pickup.y - 4 + bob, 4, 8);
      ctx.fillRect(pickup.x + 6, pickup.y - 4 + bob, 4, 8);
    }
  }
  ctx.strokeStyle = 'rgba(20, 20, 24, 0.4)';
  ctx.lineWidth = 5;
  for (const s of G.skid) {
    ctx.globalAlpha = Math.max(0, s.life / 6) * 0.5;
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(s.angle) * 14, s.y - Math.sin(s.angle) * 14);
    ctx.lineTo(s.x + Math.cos(s.angle) * 14, s.y + Math.sin(s.angle) * 14);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // GPS line and beacon to the mission target.
  const target = G.missionTarget;
  if (target) {
    const rp = nearestRoadPoint(G.player.x, G.player.y);
    const rt = nearestRoadPoint(target.x, target.y);
    // A white underlay first so the dashed line reads over the road markings.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 9;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.moveTo(G.player.x, G.player.y);
    ctx.lineTo(rp.roadX, G.player.y);
    ctx.lineTo(rp.roadX, rt.roadY);
    ctx.lineTo(rt.roadX, rt.roadY);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(242, 201, 76, 0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(G.player.x, G.player.y);
    ctx.lineTo(rp.roadX, G.player.y);
    ctx.lineTo(rp.roadX, rt.roadY);
    ctx.lineTo(rt.roadX, rt.roadY);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulse = 10 + Math.sin(G.time * 5) * 4;
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 26 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(242, 201, 76, 0.25)';
    ctx.fillRect(target.x - 4, target.y - 120, 8, 120);
    ctx.fillStyle = '#1c1e26';
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(target.label || '', target.x, target.y - 34);
  }

  // Cars, people, the player, bullets, particles.
  for (const car of G.cars) {
    if (car.kind === 'player') continue;
    drawCarShape(ctx, car, false, G.time);
  }
  if (G.player.car) drawCarShape(ctx, G.player.car, true, G.time);
  for (const ped of G.peds) drawPedShape(ctx, ped, G.time);
  if (G.player.onFoot) {
    const p = G.player;
    const bob = Math.sin(p.walkPhase) * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 10, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8590c';
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b98d';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 9 + bob, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1e26';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 11 + bob, 6, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#1c1e26';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + 2);
    ctx.lineTo(p.x + Math.cos(p.angle) * 14, p.y + Math.sin(p.angle) * 14);
    ctx.stroke();
  }
  ctx.strokeStyle = '#fff3b0';
  ctx.lineWidth = 3;
  for (const b of G.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x - Math.cos(b.angle) * 10, b.y - Math.sin(b.angle) * 10);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const pt of G.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
