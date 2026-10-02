/**
 * Spring–mass "warp grid" background. Each intersection is a point mass joined
 * to its neighbours by damped springs; the border is pinned and every point is
 * weakly tethered to its rest position. Explosions push the lattice outward,
 * gravity wells pull it in, and the ship leaves a wake — the arena literally
 * reacts to the fight.
 *
 * Data is stored as struct-of-arrays in typed arrays for cache-friendly updates.
 */
import { HALF_H, HALF_W } from './config';

const SPACING = 40;
const STIFFNESS = 0.28;
const DAMPING = 0.06;
const ANCHOR_STIFFNESS = 0.012;
const POINT_DAMPING = 0.94;

export class WarpGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly fixed: Uint8Array;
  private readonly sa: Uint32Array;
  private readonly sb: Uint32Array;
  private readonly rest: Float32Array;
  /** Per-point glow energy that decays — tints lines near impacts. */
  private readonly heat: Float32Array;
  private acc = 0;

  constructor() {
    this.cols = Math.round((HALF_W * 2) / SPACING) + 1;
    this.rows = Math.round((HALF_H * 2) / SPACING) + 1;
    const n = (this.n = this.cols * this.rows);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.ox = new Float32Array(n);
    this.oy = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.fixed = new Uint8Array(n);
    const sw = (HALF_W * 2) / (this.cols - 1);
    const sh = (HALF_H * 2) / (this.rows - 1);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.px[i] = this.ox[i] = -HALF_W + c * sw;
        this.py[i] = this.oy[i] = -HALF_H + r * sh;
        if (r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1) this.fixed[i] = 1;
      }
    }
    const springs: [number, number, number][] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        if (c < this.cols - 1) springs.push([i, i + 1, sw]);
        if (r < this.rows - 1) springs.push([i, i + this.cols, sh]);
      }
    }
    this.sa = new Uint32Array(springs.map((s) => s[0]));
    this.sb = new Uint32Array(springs.map((s) => s[1]));
    this.rest = new Float32Array(springs.map((s) => s[2] * 0.95));
  }

  /** Radial push. Positive force = outward. */
  applyExplosive(x: number, y: number, force: number, radius: number): void {
    const r2 = radius * radius;
    this.forEachInRadius(x, y, radius, (i, dx, dy, d2) => {
      if (d2 > r2) return;
      const k = (force * 100) / (10000 + d2);
      this.vx[i] += dx * k;
      this.vy[i] += dy * k;
      this.heat[i] = Math.min(1, this.heat[i]! + (1 - d2 / r2) * Math.min(1, force * 0.6));
    });
  }

  applyImplosive(x: number, y: number, force: number, radius: number): void {
    this.applyExplosive(x, y, -force, radius);
  }

  /** Directional push (e.g. ship wake). */
  applyDirected(x: number, y: number, fx: number, fy: number, radius: number): void {
    const r2 = radius * radius;
    this.forEachInRadius(x, y, radius, (i, _dx, _dy, d2) => {
      if (d2 > r2) return;
      const k = 1 - d2 / r2;
      this.vx[i] += fx * k;
      this.vy[i] += fy * k;
    });
  }

  private forEachInRadius(
    x: number,
    y: number,
    radius: number,
    fn: (i: number, dx: number, dy: number, d2: number) => void,
  ): void {
    const sw = (HALF_W * 2) / (this.cols - 1);
    const sh = (HALF_H * 2) / (this.rows - 1);
    const c0 = Math.max(1, Math.floor((x - radius + HALF_W) / sw));
    const c1 = Math.min(this.cols - 2, Math.ceil((x + radius + HALF_W) / sw));
    const r0 = Math.max(1, Math.floor((y - radius + HALF_H) / sh));
    const r1 = Math.min(this.rows - 2, Math.ceil((y + radius + HALF_H) / sh));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = this.px[i]! - x;
        const dy = this.py[i]! - y;
        fn(i, dx, dy, dx * dx + dy * dy);
      }
    }
  }

  /** Steps at a fixed 60 Hz internally (constants are tuned per-tick). */
  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      this.tick();
    }
  }

  private tick(): void {
    const { px, py, vx, vy, ox, oy, fixed, sa, sb, rest, heat } = this;
    for (let s = 0; s < sa.length; s++) {
      const a = sa[s]!;
      const b = sb[s]!;
      const dx = px[a]! - px[b]!;
      const dy = py[a]! - py[b]!;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l <= rest[s]!) continue; // springs only pull, like the classic implementation
      const nx = dx / l;
      const ny = dy / l;
      const stretch = l - rest[s]!;
      const dvx = vx[b]! - vx[a]!;
      const dvy = vy[b]! - vy[a]!;
      const f = stretch * STIFFNESS - (dvx * nx + dvy * ny) * DAMPING;
      const fx = nx * f;
      const fy = ny * f;
      vx[a] -= fx * 0.5;
      vy[a] -= fy * 0.5;
      vx[b] += fx * 0.5;
      vy[b] += fy * 0.5;
    }
    for (let i = 0; i < this.n; i++) {
      if (fixed[i]) {
        vx[i] = vy[i] = 0;
        continue;
      }
      vx[i] += (ox[i]! - px[i]!) * ANCHOR_STIFFNESS;
      vy[i] += (oy[i]! - py[i]!) * ANCHOR_STIFFNESS;
      // Clamp to keep things stable under extreme forces.
      const sp = vx[i]! * vx[i]! + vy[i]! * vy[i]!;
      if (sp > 2500) {
        const k = 50 / Math.sqrt(sp);
        vx[i] *= k;
        vy[i] *= k;
      }
      px[i] += vx[i]!;
      py[i] += vy[i]!;
      vx[i] *= POINT_DAMPING;
      vy[i] *= POINT_DAMPING;
      heat[i] *= 0.95;
    }
  }

  draw(g: CanvasRenderingContext2D, time: number): void {
    const { px, py, cols, rows, heat } = this;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.8);

    // Minor lines in one batched path, major lines (every 4th) in another.
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let r = 0; r < rows; r++) {
        const major = r % 4 === 0;
        if ((pass === 1) !== major) continue;
        let i = r * cols;
        g.moveTo(px[i]!, py[i]!);
        for (let c = 1; c < cols; c++) {
          i++;
          g.lineTo(px[i]!, py[i]!);
        }
      }
      for (let c = 0; c < cols; c++) {
        const major = c % 4 === 0;
        if ((pass === 1) !== major) continue;
        let i = c;
        g.moveTo(px[i]!, py[i]!);
        for (let r = 1; r < rows; r++) {
          i += cols;
          g.lineTo(px[i]!, py[i]!);
        }
      }
      if (pass === 0) {
        g.strokeStyle = 'rgba(60,70,255,0.16)';
        g.lineWidth = 1.2;
      } else {
        g.strokeStyle = `rgba(110,90,255,${0.26 + pulse * 0.08})`;
        g.lineWidth = 2;
      }
      g.stroke();
    }

    // Hot segments near recent impacts glow magenta.
    g.beginPath();
    let any = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (heat[i]! < 0.08) continue;
        any = true;
        if (c < cols - 1) {
          g.moveTo(px[i]!, py[i]!);
          g.lineTo(px[i + 1]!, py[i + 1]!);
        }
        if (r < rows - 1) {
          g.moveTo(px[i]!, py[i]!);
          g.lineTo(px[i + cols]!, py[i + cols]!);
        }
      }
    }
    if (any) {
      g.strokeStyle = 'rgba(255,60,200,0.35)';
      g.lineWidth = 2;
      g.stroke();
    }

    // Arena border.
    g.strokeStyle = 'rgba(120,200,255,0.9)';
    g.lineWidth = 4;
    g.strokeRect(-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2);
  }
}
