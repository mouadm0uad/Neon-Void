/**
 * High-throughput particle system: struct-of-arrays in typed arrays, a ring
 * buffer that recycles the oldest particle when full (zero GC churn), and
 * batched rendering — one path per (colour × alpha bucket) instead of one
 * draw call per particle. Comfortably handles 10k+ sparks.
 */
import { HALF_H, HALF_W, PALETTE } from './config';
import { TAU } from '../engine/math';

const MAX = 12000;
const ALPHA_BUCKETS = 4;

export interface Attractor {
  x: number;
  y: number;
  strength: number;
}

export class Particles {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private width = new Float32Array(MAX);
  private stretch = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private color = new Uint8Array(MAX);
  private head = 0;
  count = 0;
  /** Cap set by quality settings. */
  budget = MAX;

  private readonly styles: string[][] = PALETTE.map((p) =>
    Array.from({ length: ALPHA_BUCKETS }, (_, b) => `rgba(${p[0]},${p[1]},${p[2]},${(b + 1) / ALPHA_BUCKETS})`),
  );

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    color: number,
    width = 2,
    stretch = 0.035,
    drag = 2.6,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.budget;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.width[i] = width;
    this.stretch[i] = stretch;
    this.drag[i] = drag;
    this.color[i] = color;
  }

  /** Radial burst of sparks. */
  burst(x: number, y: number, n: number, color: number, speed = 520, life = 0.9, width = 2): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.9);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.4 + Math.random() * 0.8), color, width);
    }
  }

  /** Ring that expands evenly — reads as a shockwave. */
  ring(x: number, y: number, n: number, color: number, speed: number, life = 0.6): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed, life, color, 3, 0.02, 1.6);
    }
  }

  /** Directional cone, e.g. engine exhaust or bullet impact sparks. */
  cone(x: number, y: number, angle: number, spread: number, n: number, color: number, speed: number, life: number): void {
    for (let k = 0; k < n; k++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.5 + Math.random() * 0.7);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.6), color, 2);
    }
  }

  clear(): void {
    this.life.fill(0);
  }

  update(dt: number, attractors: readonly Attractor[]): void {
    const { x, y, vx, vy, life, drag } = this;
    let alive = 0;
    for (let i = 0; i < this.budget; i++) {
      if (life[i]! <= 0) continue;
      life[i] -= dt;
      if (life[i]! <= 0) continue;
      alive++;
      for (const a of attractors) {
        const dx = a.x - x[i]!;
        const dy = a.y - y[i]!;
        const d2 = dx * dx + dy * dy + 400;
        if (d2 > 250000) continue;
        const f = (a.strength * dt) / Math.sqrt(d2);
        vx[i] += dx * f * 0.02;
        vy[i] += dy * f * 0.02;
      }
      const k = Math.exp(-drag[i]! * dt);
      vx[i] *= k;
      vy[i] *= k;
      x[i] += vx[i]! * dt;
      y[i] += vy[i]! * dt;
      // Bounce off the arena walls.
      if (x[i]! < -HALF_W) {
        x[i] = -HALF_W;
        vx[i] = -vx[i]! * 0.6;
      } else if (x[i]! > HALF_W) {
        x[i] = HALF_W;
        vx[i] = -vx[i]! * 0.6;
      }
      if (y[i]! < -HALF_H) {
        y[i] = -HALF_H;
        vy[i] = -vy[i]! * 0.6;
      } else if (y[i]! > HALF_H) {
        y[i] = HALF_H;
        vy[i] = -vy[i]! * 0.6;
      }
    }
    this.count = alive;
  }

  private readonly order = new Int32Array(MAX);
  private readonly keys = new Uint8Array(MAX);
  private readonly bucketStart = new Int32Array(PALETTE.length * ALPHA_BUCKETS * 2 + 1);

  draw(g: CanvasRenderingContext2D): void {
    const { x, y, vx, vy, life, maxLife, width, stretch, color, keys, order, bucketStart } = this;
    const nb = PALETTE.length * ALPHA_BUCKETS * 2;
    // Counting sort by (colour, alpha bucket, width class): O(n), no allocations.
    bucketStart.fill(0);
    for (let i = 0; i < this.budget; i++) {
      if (life[i]! <= 0) {
        keys[i] = 255;
        continue;
      }
      const t = life[i]! / maxLife[i]!;
      const ab = Math.min(ALPHA_BUCKETS - 1, Math.floor(t * ALPHA_BUCKETS));
      const k = (color[i]! * ALPHA_BUCKETS + ab) * 2 + (width[i]! > 2.5 ? 1 : 0);
      keys[i] = k;
      bucketStart[k + 1]++;
    }
    for (let k = 0; k < nb; k++) bucketStart[k + 1] += bucketStart[k]!;
    const cursor = bucketStart.slice(0, nb);
    for (let i = 0; i < this.budget; i++) {
      const k = keys[i]!;
      if (k === 255) continue;
      order[cursor[k]!++] = i;
    }
    for (let k = 0; k < nb; k++) {
      const from = bucketStart[k]!;
      const to = bucketStart[k + 1]!;
      if (from === to) continue;
      g.beginPath();
      for (let j = from; j < to; j++) {
        const i = order[j]!;
        const t = life[i]! / maxLife[i]!;
        const s = stretch[i]! * (0.4 + t);
        g.moveTo(x[i]!, y[i]!);
        g.lineTo(x[i]! - vx[i]! * s - 0.5, y[i]! - vy[i]! * s);
      }
      const ci = (k >> 1) / ALPHA_BUCKETS | 0;
      const ab = (k >> 1) % ALPHA_BUCKETS;
      g.strokeStyle = this.styles[ci]![ab]!;
      g.lineWidth = k & 1 ? 3.5 : 2;
      g.stroke();
    }
  }
}
