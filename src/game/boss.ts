/**
 * HEXACORE — a three-phase bullet-hell guardian.
 *   Phase 1  rotating triple spiral with breathing pauses
 *   Phase 2  gapped rings + aimed fans, summons minions
 *   Phase 3  counter-rotating spirals and telegraphed wall-bouncing charges
 * Patterns are designed to always leave a readable escape route.
 */
import { TAU, angleDiff, clamp, damp } from '../engine/math';
import { HALF_H, HALF_W, rgb } from './config';
import { neon } from './shapes';
import type { EnemyKind } from './entities';

export interface BossHost {
  fireEnemyBullet(x: number, y: number, angle: number, speed: number, color?: number, radius?: number): void;
  spawnEnemy(kind: EnemyKind, x: number, y: number): void;
  shake(amount: number): void;
  sparks(x: number, y: number, n: number, color: number, speed: number): void;
  gridPush(x: number, y: number, force: number, radius: number): void;
  sfx(name: 'enemyShoot' | 'dash' | 'spawn'): void;
}

type Mode = 'enter' | 'fight' | 'telegraph' | 'charge' | 'dying';

export class Boss {
  x = 0;
  y = -HALF_H - 200;
  vx = 0;
  vy = 0;
  readonly radius = 62;
  hp: number;
  readonly maxHp: number;
  mode: Mode = 'enter';
  modeT = 0;
  age = 0;
  flash = 0;
  spiral = 0;
  private fireT = 0;
  private ringT = 0;
  private fanT = 0;
  private summonT = 4;
  private chargeT = 5;
  private cycleT = 0;
  private chargeAngle = 0;
  dyingT = 0;
  alive = true;
  readonly tier: number;

  constructor(tier: number) {
    this.tier = tier;
    this.maxHp = this.hp = 260 + tier * 140;
  }

  get phase(): 1 | 2 | 3 {
    const f = this.hp / this.maxHp;
    return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  }

  get vulnerable(): boolean {
    return this.mode !== 'enter' && this.mode !== 'dying';
  }

  get dangerous(): boolean {
    return this.mode !== 'enter' && this.mode !== 'dying';
  }

  damage(n: number): boolean {
    if (!this.vulnerable) return false;
    const before = this.phase;
    this.hp = Math.max(0, this.hp - n);
    this.flash = 0.06;
    if (this.hp <= 0) {
      this.mode = 'dying';
      this.dyingT = 0;
      return true;
    }
    return this.phase !== before;
  }

  update(dt: number, host: BossHost, px: number, py: number): void {
    this.age += dt;
    this.modeT += dt;
    this.flash = Math.max(0, this.flash - dt);
    const rate = 1 + (this.tier - 1) * 0.15;

    if (this.mode === 'dying') {
      this.dyingT += dt;
      this.spiral += dt * 6;
      if (Math.random() < 0.6) {
        const a = Math.random() * TAU;
        const r = Math.random() * this.radius;
        host.sparks(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 18, Math.random() < 0.5 ? 3 : 2, 600);
        host.shake(0.08);
      }
      if (this.dyingT > 2.2) this.alive = false;
      return;
    }

    if (this.mode === 'enter') {
      this.y += (-HALF_H * 0.35 - this.y) * damp(1.6, dt);
      this.spiral += dt * 0.6;
      if (this.modeT > 2.6) this.setMode('fight');
      return;
    }

    const phase = this.phase;

    if (this.mode === 'charge') {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const lim = (w: number) => w - this.radius;
      if (Math.abs(this.x) > lim(HALF_W)) {
        this.x = Math.sign(this.x) * lim(HALF_W);
        this.vx *= -1;
        host.shake(0.35);
        host.gridPush(this.x, this.y, 6, 260);
        this.ring(host, 20, 230, Math.random() * TAU);
      }
      if (Math.abs(this.y) > lim(HALF_H)) {
        this.y = Math.sign(this.y) * lim(HALF_H);
        this.vy *= -1;
        host.shake(0.35);
        host.gridPush(this.x, this.y, 6, 260);
        this.ring(host, 20, 230, Math.random() * TAU);
      }
      host.gridPush(this.x, this.y, 1.5, 140);
      if (this.modeT > 1.6) this.setMode('fight');
      return;
    }

    if (this.mode === 'telegraph') {
      // Track the player for most of the windup, then lock in.
      if (this.modeT < 0.6) this.chargeAngle = Math.atan2(py - this.y, px - this.x);
      if (this.modeT > 0.95) {
        this.setMode('charge');
        const sp = 1050 + this.tier * 60;
        this.vx = Math.cos(this.chargeAngle) * sp;
        this.vy = Math.sin(this.chargeAngle) * sp;
        host.sfx('dash');
        host.shake(0.25);
      }
      return;
    }

    // ── Fight: drift around, keep a respectful distance from the player.
    const tx = Math.cos(this.age * 0.25) * HALF_W * 0.45;
    const ty = Math.sin(this.age * 0.33) * HALF_H * 0.4;
    const mx = (tx * 0.6 + px * 0.4) - this.x;
    const my = (ty * 0.6 + py * 0.4) - this.y;
    const ml = Math.hypot(mx, my) || 1;
    const sp = phase === 1 ? 70 : phase === 2 ? 110 : 140;
    this.vx += ((mx / ml) * sp - this.vx) * damp(2, dt);
    this.vy += ((my / ml) * sp - this.vy) * damp(2, dt);
    this.x = clamp(this.x + this.vx * dt, -HALF_W + this.radius, HALF_W - this.radius);
    this.y = clamp(this.y + this.vy * dt, -HALF_H + this.radius, HALF_H - this.radius);

    this.cycleT += dt;
    const toPlayer = Math.atan2(py - this.y, px - this.x);

    if (phase === 1) {
      this.spiral += dt * 1.5;
      const firing = this.cycleT % 4.2 < 3;
      if (firing) {
        this.fireT -= dt * rate;
        while (this.fireT <= 0) {
          this.fireT += 0.11;
          for (let i = 0; i < 3; i++) this.shootFromRim(host, this.spiral + (i * TAU) / 3, 230);
          host.sfx('enemyShoot');
        }
      }
    } else if (phase === 2) {
      this.spiral += dt * 0.9;
      this.ringT -= dt * rate;
      if (this.ringT <= 0) {
        this.ringT = 1.7;
        // Ring with a deliberate gap so there is always a way through.
        const gapAt = toPlayer + (Math.random() - 0.5) * 1.2;
        const n = 28;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          if (Math.abs(angleDiff(a, gapAt)) < 0.38) continue;
          host.fireEnemyBullet(this.x, this.y, a, 210, 2, 7);
        }
        host.sfx('enemyShoot');
        host.gridPush(this.x, this.y, 3, 220);
      }
      this.fanT -= dt * rate;
      if (this.fanT <= 0) {
        this.fanT = 0.85;
        for (let i = -2; i <= 2; i++) host.fireEnemyBullet(this.x, this.y, toPlayer + i * 0.16, 320, 6, 6);
      }
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = 7;
        for (let i = 0; i < 4 + this.tier; i++) {
          const a = (i / (4 + this.tier)) * TAU;
          host.spawnEnemy('mini', this.x + Math.cos(a) * 110, this.y + Math.sin(a) * 110);
        }
        host.sfx('spawn');
      }
    } else {
      this.spiral += dt * 1.1;
      this.fireT -= dt * rate;
      while (this.fireT <= 0) {
        this.fireT += 0.2;
        for (let i = 0; i < 4; i++) {
          this.shootFromRim(host, this.spiral + (i * TAU) / 4, 200);
          this.shootFromRim(host, -this.spiral * 1.3 + (i * TAU) / 4 + 0.4, 160, 5);
        }
      }
      this.chargeT -= dt;
      if (this.chargeT <= 0) {
        this.chargeT = 5.5;
        this.setMode('telegraph');
        this.chargeAngle = toPlayer;
      }
    }
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.modeT = 0;
  }

  private shootFromRim(host: BossHost, a: number, speed: number, color = 2): void {
    host.fireEnemyBullet(this.x + Math.cos(a) * this.radius, this.y + Math.sin(a) * this.radius, a, speed, color, 6);
  }

  private ring(host: BossHost, n: number, speed: number, off: number): void {
    for (let i = 0; i < n; i++) host.fireEnemyBullet(this.x, this.y, off + (i / n) * TAU, speed, 6, 6);
  }

  draw(g: CanvasRenderingContext2D, time: number): void {
    const phase = this.phase;
    const main = this.flash > 0 ? 0 : phase === 1 ? 3 : phase === 2 ? 2 : 7;
    const r = this.radius;
    const dying = this.mode === 'dying';
    const shake = dying ? (Math.random() - 0.5) * 10 : 0;

    if (this.mode === 'telegraph') {
      const k = this.modeT / 0.95;
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(this.x + Math.cos(this.chargeAngle) * 2400, this.y + Math.sin(this.chargeAngle) * 2400);
      g.strokeStyle = rgb(7, 0.15 + k * 0.5 * (Math.sin(time * 50) > 0 ? 1 : 0.4));
      g.lineWidth = 4 + k * 26;
      g.stroke();
    }

    g.save();
    g.translate(this.x + shake, this.y + shake);

    // Outer hexagon.
    g.save();
    g.rotate(this.spiral * 0.5);
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU;
      const rr = r * (1 + (i % 2 ? 0 : 0.08 * Math.sin(time * 6)));
      if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    neon(g, main, 3.5);
    // Vertex nodes.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, 6, 0, TAU);
      neon(g, 1, 2);
    }
    g.restore();

    // Counter-rotating inner triangle.
    g.save();
    g.rotate(-this.spiral * 1.4);
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * TAU;
      if (i === 0) g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      else g.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
    }
    neon(g, 5, 2.5);
    g.restore();

    // Pulsing core.
    const pulse = 0.75 + Math.sin(time * (phase * 4)) * 0.25;
    g.beginPath();
    g.arc(0, 0, r * 0.26 * pulse, 0, TAU);
    g.fillStyle = rgb(main, 0.85);
    g.fill();
    g.beginPath();
    g.arc(0, 0, r * 0.12, 0, TAU);
    g.fillStyle = rgb(0, 1);
    g.fill();

    // Orbiting shield arcs.
    g.rotate(time * 1.8);
    for (let i = 0; i < 3; i++) {
      g.rotate(TAU / 3);
      g.beginPath();
      g.arc(0, 0, r * 1.35, 0, 0.8);
      neon(g, 1, 2, 0.6);
    }
    g.restore();
  }
}
