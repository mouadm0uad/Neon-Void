/** Vector art. Everything is drawn procedurally as glowing line work. */
import { TAU } from '../engine/math';
import { rgb } from './config';
import type { Enemy, Pickup } from './entities';

/** Neon stroke: soft wide pass + bright core. Bloom does the rest. */
export function neon(g: CanvasRenderingContext2D, color: number, width: number, alpha = 1): void {
  g.strokeStyle = rgb(color, 0.22 * alpha);
  g.lineWidth = width * 3;
  g.stroke();
  g.strokeStyle = rgb(color, alpha);
  g.lineWidth = width;
  g.stroke();
}

function poly(g: CanvasRenderingContext2D, pts: readonly number[]): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
}

function regular(g: CanvasRenderingContext2D, sides: number, r: number, rot = 0): void {
  g.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

export function drawShip(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: number,
  alpha = 1,
  scale = 1,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(scale, scale);
  // Claw-shaped fighter.
  poly(g, [18, 0, -6, 13, -12, 9, -3, 0, -12, -9, -6, -13]);
  neon(g, color, 2.4, alpha);
  g.beginPath();
  g.moveTo(4, 0);
  g.lineTo(-3, 4);
  g.lineTo(-3, -4);
  g.closePath();
  g.fillStyle = rgb(0, 0.8 * alpha);
  g.fill();
  g.restore();
}

export function drawEnemy(g: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const def = e.def;
  let color = def.color;
  let alpha = 1;
  if (e.spawning > 0) {
    // Telegraph: collapsing ring + flickering ghost.
    const k = Math.min(1, e.spawning / 0.9);
    g.beginPath();
    g.arc(e.x, e.y, e.radius + k * 46, 0, TAU);
    g.strokeStyle = rgb(color, 0.6 * (1 - k) + 0.15);
    g.lineWidth = 2;
    g.stroke();
    alpha = (Math.sin(time * 40) > 0 ? 0.5 : 0.15) * (1 - k * 0.6);
  }
  if (e.flash > 0) color = 0;

  g.save();
  g.translate(e.x, e.y);
  const r = e.radius;
  switch (e.kind) {
    case 'drifter': {
      // Pinwheel.
      g.rotate(e.age * 3);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        g.rotate(TAU / 4);
        g.moveTo(0, 0);
        g.lineTo(r, 0);
        g.lineTo(r * 0.55, -r * 0.7);
        g.closePath();
      }
      neon(g, color, 2, alpha);
      break;
    }
    case 'seeker': {
      const sx = 1 + Math.sin(e.age * 8) * 0.12;
      g.scale(sx, 2 - sx);
      poly(g, [0, -r, r * 0.8, 0, 0, r, -r * 0.8, 0]);
      neon(g, color, 2.2, alpha);
      break;
    }
    case 'dart': {
      g.rotate(e.angle);
      g.beginPath();
      g.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
      g.moveTo(-r * 0.75, -r * 0.75);
      g.lineTo(r * 0.75, r * 0.75);
      g.moveTo(r * 0.75, -r * 0.75);
      g.lineTo(-r * 0.75, r * 0.75);
      neon(g, color, 2, alpha);
      break;
    }
    case 'splitter': {
      g.rotate(e.age * 1.2);
      regular(g, 4, r, 0);
      neon(g, color, 2.4, alpha);
      g.rotate(-e.age * 2.4);
      regular(g, 4, r * 0.55, Math.PI / 4);
      neon(g, color, 1.6, alpha);
      break;
    }
    case 'mini': {
      g.rotate(e.angle);
      poly(g, [r, 0, -r * 0.8, r * 0.7, -r * 0.8, -r * 0.7]);
      neon(g, color, 1.8, alpha);
      break;
    }
    case 'gunner': {
      g.rotate(e.angle);
      poly(g, [r * 1.1, 0, -r * 0.7, r * 0.9, -r * 0.35, 0, -r * 0.7, -r * 0.9]);
      neon(g, color, 2.2, alpha);
      // Charge indicator.
      if (e.cooldown < 0.5 && e.spawning <= 0) {
        g.beginPath();
        g.arc(r * 1.1, 0, 3 + (0.5 - e.cooldown) * 10, 0, TAU);
        g.fillStyle = rgb(3, 0.8);
        g.fill();
      }
      break;
    }
    case 'well': {
      const pulse = 1 + Math.sin(e.age * 6) * 0.08 + e.fed * 0.04;
      const rr = r * pulse;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, rr * (1 - i * 0.28), 0, TAU);
        neon(g, color, 2.5 - i * 0.6, alpha * (1 - i * 0.2));
      }
      // Accretion arcs.
      g.rotate(-e.age * 2.5);
      for (let i = 0; i < 3; i++) {
        g.rotate(TAU / 3);
        g.beginPath();
        g.arc(0, 0, rr * 1.6, 0, 0.9);
        neon(g, 6, 1.5, alpha * 0.7);
      }
      break;
    }
  }
  g.restore();

  // HP ring for tanky enemies.
  if (e.maxHp >= 4 && e.hp < e.maxHp && e.spawning <= 0) {
    g.beginPath();
    g.arc(e.x, e.y, e.radius + 10, -Math.PI / 2, -Math.PI / 2 + (e.hp / e.maxHp) * TAU);
    g.strokeStyle = rgb(def.color, 0.7);
    g.lineWidth = 2;
    g.stroke();
  }
}

const PICKUP_STYLE: Record<Exclude<Pickup['kind'], 'shard'>, { color: number; glyph: string }> = {
  weapon: { color: 3, glyph: 'W' },
  shield: { color: 1, glyph: 'S' },
  bomb: { color: 2, glyph: 'B' },
  rapid: { color: 6, glyph: 'O' },
  life: { color: 4, glyph: '+' },
  magnet: { color: 5, glyph: 'M' },
};

export function pickupColor(kind: Pickup['kind']): number {
  return kind === 'shard' ? 4 : PICKUP_STYLE[kind].color;
}

export function drawPickup(g: CanvasRenderingContext2D, p: Pickup, time: number): void {
  if (p.kind === 'shard') {
    const a = p.life < 1.5 ? (Math.sin(time * 30) > 0 ? 0.9 : 0.3) : 0.9;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(time * 4 + p.x);
    poly(g, [0, -6, 4, 0, 0, 6, -4, 0]);
    g.strokeStyle = rgb(4, a);
    g.lineWidth = 2;
    g.stroke();
    g.restore();
    return;
  }
  const st = PICKUP_STYLE[p.kind];
  const blink = p.life < 3 && Math.sin(time * 20) < 0;
  const alpha = blink ? 0.35 : 1;
  const s = 1 + Math.sin(time * 5) * 0.08;
  g.save();
  g.translate(p.x, p.y);
  g.scale(s, s);
  regular(g, 6, 18, time);
  neon(g, st.color, 2.2, alpha);
  g.rotate(0);
  g.globalCompositeOperation = 'source-over';
  g.font = '700 16px "Orbitron", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = rgb(st.color, alpha);
  g.fillText(st.glyph, 0, 1);
  g.globalCompositeOperation = 'lighter';
  g.restore();
}
