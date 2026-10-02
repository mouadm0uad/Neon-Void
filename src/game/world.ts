/**
 * The simulation: owns every entity and system, runs gameplay rules, and draws
 * the world layer. Pure-ish — it talks to the outside only through `hooks`.
 */
import type { AudioEngine } from '../engine/audio';
import { Rng } from '../engine/rng';
import { SpatialHash } from '../engine/spatialHash';
import { TAU, angleDiff, clamp, damp, len } from '../engine/math';
import type { Renderer } from '../engine/renderer';
import { Boss, type BossHost } from './boss';
import { BG, C, HALF_H, HALF_W, PLAYER, SCORE, rgb } from './config';
import { Bullet, ENEMY_DEFS, Enemy, Pickup, type EnemyKind, type FloatText, type PickupKind } from './entities';
import { WarpGrid } from './grid';
import { t } from './i18n';
import { Particles, type Attractor } from './particles';
import { drawEnemy, drawPickup, drawShip, pickupColor } from './shapes';
import { planWave, type SpawnGroup, type WavePlan } from './waves';

export interface Controls {
  moveX: number;
  moveY: number;
  /** World-space aim angle. */
  aim: number;
  firing: boolean;
  bomb: boolean;
  dash: boolean;
}

export interface RunStats {
  score: number;
  wave: number;
  kills: number;
  maxMult: number;
  time: number;
}

export interface WorldHooks {
  audio: AudioEngine;
  renderer: Renderer;
  shakeScale: () => number;
  onGameOver: (stats: RunStats) => void;
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  speed: number;
  max: number;
  color: number;
  width: number;
  /** Bomb waves destroy what they touch. */
  lethal: boolean;
}

export interface Banner {
  text: string;
  sub: string;
  t: number;
  color: number;
}

const WEAPON_PATTERNS: readonly (readonly [angle: number, offset: number])[][] = [
  [],
  [[0, -6], [0, 6]],
  [[-0.08, 0], [0, 0], [0.08, 0]],
  [[-0.14, 0], [-0.045, -5], [0.045, 5], [0.14, 0]],
  [[-0.2, 0], [-0.1, 0], [0, 0], [0.1, 0], [0.2, 0]],
  [[-0.5, 0], [-0.2, 0], [-0.1, 0], [0, 0], [0.1, 0], [0.2, 0], [0.5, 0]],
];

export class World implements BossHost {
  readonly grid = new WarpGrid();
  readonly particles = new Particles();
  readonly enemies: Enemy[] = [];
  readonly pBullets: Bullet[] = [];
  readonly eBullets: Bullet[] = [];
  readonly pickups: Pickup[] = [];
  readonly texts: FloatText[] = [];
  readonly shockwaves: Shockwave[] = [];
  private readonly enemyHash = new SpatialHash<Enemy>(80);
  private readonly bulletHash = new SpatialHash<Bullet>(80);
  private readonly attractors: Attractor[] = [];
  private rng = new Rng();
  private seed = Date.now() & 0xffff;

  boss: Boss | null = null;
  private bossDelay = 0;

  // Player.
  px = 0;
  py = 0;
  pvx = 0;
  pvy = 0;
  pAngle = -Math.PI / 2;
  dead = false;
  private deadT = 0;
  invuln = 0;
  dashT = 0;
  dashCd = 0;
  private dashDx = 0;
  private dashDy = 0;
  private fireCd = 0;
  lives: number = PLAYER.startLives;
  bombs: number = PLAYER.startBombs;
  weapon = 1;
  shield = false;
  rapidT = 0;
  magnetT = 0;

  // Scoring.
  score = 0;
  mult = 1;
  maxMult = 1;
  kills = 0;
  combo = 0;
  comboT = 0;
  private killsSinceDrop = 0;
  private extraLifeAt = 75000;

  // Flow.
  wave = 0;
  private plan: WavePlan | null = null;
  private waveT = 0;
  private groupIdx = 0;
  private intermission = 0;
  time = 0;
  runTime = 0;
  timeScale = 1;
  private targetTimeScale = 1;
  private hitstop = 0;
  banner: Banner | null = null;
  attract = false;
  over = false;

  constructor(private readonly hooks: WorldHooks) {}

  // ─────────────────────────────── lifecycle ───────────────────────────────

  reset(attract: boolean): void {
    this.attract = attract;
    this.enemies.length = 0;
    this.pBullets.length = 0;
    this.eBullets.length = 0;
    this.pickups.length = 0;
    this.texts.length = 0;
    this.shockwaves.length = 0;
    this.particles.clear();
    this.boss = null;
    this.bossDelay = 0;
    this.px = this.py = this.pvx = this.pvy = 0;
    this.dead = false;
    this.over = false;
    this.invuln = attract ? 1e9 : 2;
    this.dashT = this.dashCd = this.fireCd = 0;
    this.lives = PLAYER.startLives;
    this.bombs = PLAYER.startBombs;
    this.weapon = attract ? 3 : 1;
    this.shield = false;
    this.rapidT = this.magnetT = 0;
    this.score = 0;
    this.mult = this.maxMult = 1;
    this.kills = this.combo = this.comboT = 0;
    this.killsSinceDrop = 0;
    this.extraLifeAt = 75000;
    this.wave = 0;
    this.time = this.runTime = 0;
    this.timeScale = this.targetTimeScale = 1;
    this.hitstop = 0;
    this.banner = null;
    this.seed = (Date.now() ^ (Math.random() * 1e9)) & 0xffffff;
    this.rng = new Rng(this.seed);
    this.intermission = attract ? 0.5 : 1.2;
    this.hooks.renderer.camera.x = 0;
    this.hooks.renderer.camera.y = 0;
  }

  get stats(): RunStats {
    return { score: this.score, wave: this.wave, kills: this.kills, maxMult: this.maxMult, time: this.runTime };
  }

  get activeEnemyCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  // ─────────────────────────────── update ───────────────────────────────

  update(dt: number, c: Controls): void {
    const r = this.hooks.renderer;
    r.update(dt, this.hooks.shakeScale());
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.timeScale += (this.targetTimeScale - this.timeScale) * damp(6, dt);
    if (this.targetTimeScale < 1) this.targetTimeScale = Math.min(1, this.targetTimeScale + dt * 0.6);
    const sdt = dt * this.timeScale;
    this.time += sdt;
    if (!this.dead && !this.attract) this.runTime += sdt;

    this.updatePlayer(sdt, c);
    this.updateWaves(sdt);
    this.rebuildHashes();
    this.updateEnemies(sdt);
    this.updateBoss(sdt);
    this.updateBullets(sdt);
    this.updatePickups(sdt);
    this.updateShockwaves(sdt);
    this.updateTexts(sdt);

    this.attractors.length = 0;
    for (const e of this.enemies) if (e.kind === 'well' && e.active) this.attractors.push({ x: e.x, y: e.y, strength: 9000 });
    this.particles.update(sdt, this.attractors);
    this.grid.update(sdt);

    if (this.comboT > 0) {
      this.comboT -= sdt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 2.6) this.banner = null;
    }

    // Music follows the action.
    const target = this.boss ? 1 : clamp(0.15 + this.wave * 0.07 + this.activeEnemyCount * 0.012, 0, 0.95);
    this.hooks.audio.intensity += (target - this.hooks.audio.intensity) * damp(0.5, dt);

    // Camera: follow with a little look-ahead toward the aim.
    const cam = r.camera;
    const vh = r.viewHalf;
    const lead = this.dead ? 0 : 60;
    let tx = this.px + Math.cos(this.pAngle) * lead;
    let ty = this.py + Math.sin(this.pAngle) * lead;
    const margin = 90;
    tx = vh.w >= HALF_W + margin ? 0 : clamp(tx, -HALF_W - margin + vh.w, HALF_W + margin - vh.w);
    ty = vh.h >= HALF_H + margin ? 0 : clamp(ty, -HALF_H - margin + vh.h, HALF_H + margin - vh.h);
    cam.x += (tx - cam.x) * damp(5, dt);
    cam.y += (ty - cam.y) * damp(5, dt);
  }

  private updatePlayer(dt: number, c: Controls): void {
    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 2.4 && !this.over) {
        this.over = true;
        this.hooks.onGameOver(this.stats);
      }
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.rapidT = Math.max(0, this.rapidT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);

    if (c.bomb) this.detonateBomb();

    if (c.dash && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = c.moveX;
      let dy = c.moveY;
      if (len(dx, dy) < 0.1) {
        dx = Math.cos(this.pAngle);
        dy = Math.sin(this.pAngle);
      }
      const l = len(dx, dy);
      this.dashDx = dx / l;
      this.dashDy = dy / l;
      this.dashT = PLAYER.dashTime;
      this.dashCd = PLAYER.dashCooldown;
      this.hooks.audio.play('dash');
      this.particles.ring(this.px, this.py, 24, C.Cyan, 320, 0.35);
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pvx = this.dashDx * PLAYER.dashSpeed;
      this.pvy = this.dashDy * PLAYER.dashSpeed;
      // After-image sparks.
      for (let i = 0; i < 3; i++) {
        this.particles.spawn(this.px + (Math.random() - 0.5) * 10, this.py + (Math.random() - 0.5) * 10, -this.pvx * 0.1, -this.pvy * 0.1, 0.35, C.Cyan, 3, 0.05, 4);
      }
      if (this.dashT <= 0) {
        this.pvx *= 0.35;
        this.pvy *= 0.35;
      }
    } else {
      const k = damp(PLAYER.friction, dt);
      this.pvx += (c.moveX * PLAYER.maxSpeed - this.pvx) * k;
      this.pvy += (c.moveY * PLAYER.maxSpeed - this.pvy) * k;
    }

    // Gravity wells tug at the ship.
    for (const e of this.enemies) {
      if (e.kind !== 'well' || !e.active) continue;
      const dx = e.x - this.px;
      const dy = e.y - this.py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 420 * 420) {
        const d = Math.sqrt(d2) || 1;
        const f = (1 - d / 420) * 900 * dt;
        this.pvx += (dx / d) * f;
        this.pvy += (dy / d) * f;
      }
    }

    this.px += this.pvx * dt;
    this.py += this.pvy * dt;
    const R = PLAYER.radius;
    if (this.px < -HALF_W + R) (this.px = -HALF_W + R), (this.pvx = 0);
    if (this.px > HALF_W - R) (this.px = HALF_W - R), (this.pvx = 0);
    if (this.py < -HALF_H + R) (this.py = -HALF_H + R), (this.pvy = 0);
    if (this.py > HALF_H - R) (this.py = HALF_H - R), (this.pvy = 0);

    // Facing: aim when firing, otherwise heading.
    const speed = len(this.pvx, this.pvy);
    if (c.firing) this.pAngle = c.aim;
    else if (speed > 40) this.pAngle += angleDiff(this.pAngle, Math.atan2(this.pvy, this.pvx)) * damp(10, dt);

    // Engine exhaust + grid wake.
    if (speed > 60) {
      const back = Math.atan2(-this.pvy, -this.pvx);
      this.particles.cone(this.px - (this.pvx / speed) * 12, this.py - (this.pvy / speed) * 12, back, 0.5, 1, Math.random() < 0.6 ? C.Orange : C.Gold, 260, 0.35);
      this.grid.applyDirected(this.px, this.py, this.pvx * 0.0016, this.pvy * 0.0016, 70);
    }

    // Weapons.
    this.fireCd -= dt;
    if (c.firing && this.fireCd <= 0) {
      this.fireCd = PLAYER.fireInterval * (this.rapidT > 0 ? 0.5 : 1);
      this.fire(c.aim);
    }
  }

  private fire(aim: number): void {
    const pattern = WEAPON_PATTERNS[this.weapon]!;
    const cos = Math.cos(aim);
    const sin = Math.sin(aim);
    for (const [da, off] of pattern) {
      const a = aim + da + (Math.random() - 0.5) * 0.03;
      const b = this.takeBullet(this.pBullets);
      b.x = this.px + cos * 16 - sin * off;
      b.y = this.py + sin * 16 + cos * off;
      b.vx = Math.cos(a) * PLAYER.bulletSpeed + this.pvx * 0.3;
      b.vy = Math.sin(a) * PLAYER.bulletSpeed + this.pvy * 0.3;
      b.radius = 6;
      b.life = 1.2;
      b.damage = 1;
      b.color = this.rapidT > 0 ? C.Orange : C.Gold;
      b.pierce = this.weapon >= 5 ? 1 : 0;
    }
    this.hooks.audio.play('shoot', 0.9 + Math.random() * 0.2);
    this.particles.cone(this.px + cos * 18, this.py + sin * 18, aim, 0.6, 2, C.Gold, 300, 0.12);
  }

  private takeBullet(pool: Bullet[]): Bullet {
    for (const b of pool) if (!b.alive) return ((b.alive = true), b);
    const b = new Bullet();
    b.alive = true;
    pool.push(b);
    return b;
  }

  // ─────────────────────────────── waves ───────────────────────────────

  private updateWaves(dt: number): void {
    if (this.dead) return;
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
      return;
    }
    const plan = this.plan;
    if (!plan) return;
    this.waveT += dt;
    while (this.groupIdx < plan.groups.length && plan.groups[this.groupIdx]!.at <= this.waveT) {
      this.spawnGroup(plan.groups[this.groupIdx]!, plan.speedMul);
      this.groupIdx++;
    }
    if (this.bossDelay > 0) {
      this.bossDelay -= dt;
      if (this.bossDelay <= 0) {
        this.boss = new Boss(plan.number / 5);
        this.hooks.audio.play('wave');
        this.shake(0.4);
      }
    }
    const allSpawned = this.groupIdx >= plan.groups.length;
    const lastAt = plan.groups.length ? plan.groups[plan.groups.length - 1]!.at : 0;
    if (plan.boss) {
      if (allSpawned && !this.boss && this.bossDelay <= 0 && this.activeEnemyCount === 0) this.intermission = 2.5;
    } else if (allSpawned && (this.activeEnemyCount === 0 || this.waveT > lastAt + 22)) {
      this.intermission = this.activeEnemyCount === 0 ? 1.6 : 0.01;
    }
  }

  private startWave(n: number): void {
    if (this.attract && n % 5 === 0) n++;
    if (this.attract && n > 9) n = 1;
    this.wave = n;
    this.plan = planWave(n, this.seed);
    this.waveT = 0;
    this.groupIdx = 0;
    if (this.plan.boss) {
      this.bossDelay = 2.2;
      if (!this.attract) this.banner = { text: t('bossIncoming'), sub: t('bossName'), t: 0, color: C.Red };
    } else if (!this.attract) {
      this.banner = { text: t('waveIncoming', { n }), sub: '', t: 0, color: C.Cyan };
    }
    if (!this.attract) this.hooks.audio.play('wave');
  }

  private spawnGroup(g: SpawnGroup, speedMul: number): void {
    const pts: [number, number][] = [];
    const inset = 60;
    const W = HALF_W - inset;
    const H = HALF_H - inset;
    const farPoint = (minD: number): [number, number] => {
      for (let tries = 0; tries < 30; tries++) {
        const x = this.rng.range(-W, W);
        const y = this.rng.range(-H, H);
        if (Math.hypot(x - this.px, y - this.py) >= minD) return [x, y];
      }
      return [-Math.sign(this.px || 1) * W * 0.8, -Math.sign(this.py || 1) * H * 0.8];
    };
    switch (g.formation) {
      case 'cluster': {
        const [cx, cy] = farPoint(450);
        for (let i = 0; i < g.count; i++) {
          const a = this.rng.next() * TAU;
          const r = Math.sqrt(this.rng.next()) * (40 + g.count * 8);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        break;
      }
      case 'ring': {
        const R = 430;
        const off = this.rng.next() * TAU;
        for (let i = 0; i < g.count; i++) {
          const a = off + (i / g.count) * TAU;
          pts.push([this.px + Math.cos(a) * R, this.py + Math.sin(a) * R]);
        }
        break;
      }
      case 'edges': {
        for (let i = 0; i < g.count; i++) {
          const side = this.rng.int(0, 3);
          const u = this.rng.range(-1, 1);
          pts.push(side === 0 ? [u * W, -H] : side === 1 ? [W, u * H] : side === 2 ? [u * W, H] : [-W, u * H]);
        }
        break;
      }
      case 'line': {
        const vertical = this.rng.chance(0.5);
        const sideSign = vertical ? -Math.sign(this.px || 1) : -Math.sign(this.py || 1);
        for (let i = 0; i < g.count; i++) {
          const u = g.count === 1 ? 0 : (i / (g.count - 1)) * 2 - 1;
          pts.push(vertical ? [sideSign * W * 0.9, u * H * 0.8] : [u * W * 0.8, sideSign * H * 0.9]);
        }
        break;
      }
      case 'scatter':
      default:
        for (let i = 0; i < g.count; i++) pts.push(farPoint(320));
    }
    pts.forEach(([x, y], i) => {
      // Never spawn right on top of the player.
      const d = Math.hypot(x - this.px, y - this.py);
      if (d < 220) {
        const k = 220 / (d || 1);
        x = this.px + (x - this.px) * k;
        y = this.py + (y - this.py) * k;
      }
      const e = this.makeEnemy(g.kind, clamp(x, -W, W), clamp(y, -H, H));
      e.spawning = 0.9 + i * 0.05;
      e.speedMul = speedMul;
    });
    this.hooks.audio.play('spawn');
  }

  private makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const e = new Enemy(kind);
    const def = ENEMY_DEFS[kind];
    e.x = x;
    e.y = y;
    e.radius = def.radius;
    e.hp = e.maxHp = def.hp;
    e.wanderAngle = this.rng.next() * TAU;
    e.angle = Math.atan2(this.py - y, this.px - x);
    e.cooldown = 1.2 + this.rng.next() * 1.5;
    this.enemies.push(e);
    return e;
  }

  // BossHost
  spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    const e = this.makeEnemy(kind, clamp(x, -HALF_W + 30, HALF_W - 30), clamp(y, -HALF_H + 30, HALF_H - 30));
    e.spawning = 0.5;
  }

  fireEnemyBullet(x: number, y: number, angle: number, speed: number, color: number = C.Magenta, radius = 6): void {
    const b = this.takeBullet(this.eBullets);
    b.x = x;
    b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = radius;
    b.life = 8;
    b.color = color;
  }

  shake(amount: number): void {
    this.hooks.renderer.addTrauma(amount);
  }

  sparks(x: number, y: number, n: number, color: number, speed: number): void {
    this.particles.burst(x, y, n, color, speed);
  }

  gridPush(x: number, y: number, force: number, radius: number): void {
    this.grid.applyExplosive(x, y, force, radius);
  }

  sfx(name: 'enemyShoot' | 'dash' | 'spawn'): void {
    this.hooks.audio.play(name);
  }

  // ─────────────────────────────── enemies ───────────────────────────────

  private rebuildHashes(): void {
    this.enemyHash.clear();
    for (const e of this.enemies) if (e.active) this.enemyHash.insert(e);
    this.bulletHash.clear();
    for (const b of this.pBullets) if (b.alive) this.bulletHash.insert(b);
  }

  private updateEnemies(dt: number): void {
    const px = this.px;
    const py = this.py;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.age += dt;
      e.flash = Math.max(0, e.flash - dt);
      if (e.spawning > 0) {
        e.spawning -= dt;
        if (e.spawning <= 0) {
          this.particles.ring(e.x, e.y, 14, e.def.color, 220, 0.35);
          this.grid.applyExplosive(e.x, e.y, 1.2, 120);
        }
        continue;
      }
      const def = e.def;
      const sp = def.speed * e.speedMul;
      const dx = px - e.x;
      const dy = py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const targetless = this.dead;
      let tvx = 0;
      let tvy = 0;
      let resp = 3;

      switch (e.kind) {
        case 'drifter':
          e.wanderAngle += (Math.random() - 0.5) * 6 * dt;
          tvx = Math.cos(e.wanderAngle) * sp;
          tvy = Math.sin(e.wanderAngle) * sp;
          resp = 1.5;
          break;
        case 'seeker':
        case 'mini':
          if (targetless) {
            tvx = e.vx * 0.98;
            tvy = e.vy * 0.98;
          } else {
            tvx = ux * sp;
            tvy = uy * sp;
          }
          resp = e.kind === 'mini' ? 4 : 2.6;
          e.angle = Math.atan2(e.vy, e.vx);
          break;
        case 'splitter': {
          const wob = Math.sin(e.age * 3) * 0.6;
          tvx = (ux * Math.cos(wob) - uy * Math.sin(wob)) * sp;
          tvy = (uy * Math.cos(wob) + ux * Math.sin(wob)) * sp;
          resp = 2;
          break;
        }
        case 'dart': {
          tvx = ux * sp;
          tvy = uy * sp;
          // Dodge incoming bullets: steer perpendicular to their path.
          const near = this.bulletHash.query(e.x, e.y, 110);
          for (const b of near) {
            const bx = e.x - b.x;
            const by = e.y - b.y;
            const dot = bx * b.vx + by * b.vy;
            if (dot <= 0) continue; // moving away
            const bl = Math.hypot(b.vx, b.vy) || 1;
            const side = Math.sign(bx * -b.vy + by * b.vx) || 1;
            tvx += (-b.vy / bl) * side * sp * 1.8;
            tvy += (b.vx / bl) * side * sp * 1.8;
          }
          e.angle += dt * 4;
          resp = 6;
          break;
        }
        case 'gunner': {
          e.angle = Math.atan2(dy, dx);
          const ideal = 380;
          const radial = d < ideal - 50 ? -1 : d > ideal + 50 ? 1 : 0;
          const orbit = Math.sin(e.age * 0.7 + e.wanderAngle) > 0 ? 1 : -1;
          tvx = (ux * radial + -uy * orbit * 0.7) * sp;
          tvy = (uy * radial + ux * orbit * 0.7) * sp;
          resp = 2;
          e.cooldown -= dt * e.speedMul;
          if (e.cooldown <= 0 && !targetless && d < 900) {
            e.cooldown = 2.3;
            for (const o of [-0.12, 0, 0.12]) this.fireEnemyBullet(e.x + ux * 20, e.y + uy * 20, e.angle + o, 300, C.Orange, 6);
            this.hooks.audio.play('enemyShoot');
            this.particles.cone(e.x + ux * 20, e.y + uy * 20, e.angle, 0.8, 6, C.Orange, 260, 0.25);
          }
          break;
        }
        case 'well': {
          tvx = ux * sp;
          tvy = uy * sp;
          resp = 0.5;
          this.grid.applyImplosive(e.x, e.y, 0.35 + e.fed * 0.03, 220);
          // Swallow nearby enemies; overfed wells go supernova.
          for (const o of this.enemyHash.query(e.x, e.y, 300)) {
            if (o === e || !o.active || o.kind === 'well') continue;
            const ox = e.x - o.x;
            const oy = e.y - o.y;
            const od = Math.hypot(ox, oy) || 1;
            if (od < 300) {
              o.vx += (ox / od) * 500 * dt;
              o.vy += (oy / od) * 500 * dt;
            }
            if (od < e.radius + o.radius * 0.5) {
              o.alive = false;
              e.fed++;
              e.hp += 2;
              e.maxHp = Math.max(e.maxHp, e.hp);
              this.particles.burst(o.x, o.y, 14, o.def.color, 200, 0.5);
            }
          }
          if (e.fed >= 10) this.wellSupernova(e);
          break;
        }
      }

      e.vx += (tvx - e.vx) * damp(resp, dt);
      e.vy += (tvy - e.vy) * damp(resp, dt);

      // Soft separation so swarms read as shapes, not blobs.
      for (const o of this.enemyHash.query(e.x, e.y, e.radius * 2)) {
        if (o === e) continue;
        const sx = e.x - o.x;
        const sy = e.y - o.y;
        const sd2 = sx * sx + sy * sy;
        const min = e.radius + o.radius;
        if (sd2 > 0.01 && sd2 < min * min) {
          const sd = Math.sqrt(sd2);
          const push = ((min - sd) / sd) * 6;
          e.vx += sx * push;
          e.vy += sy * push;
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const R = e.radius;
      if (e.x < -HALF_W + R) (e.x = -HALF_W + R), (e.vx = Math.abs(e.vx)), (e.wanderAngle = Math.PI - e.wanderAngle);
      if (e.x > HALF_W - R) (e.x = HALF_W - R), (e.vx = -Math.abs(e.vx)), (e.wanderAngle = Math.PI - e.wanderAngle);
      if (e.y < -HALF_H + R) (e.y = -HALF_H + R), (e.vy = Math.abs(e.vy)), (e.wanderAngle = -e.wanderAngle);
      if (e.y > HALF_H - R) (e.y = HALF_H - R), (e.vy = -Math.abs(e.vy)), (e.wanderAngle = -e.wanderAngle);

      // Contact with player.
      if (!this.dead && this.canBeHit() && Math.hypot(e.x - px, e.y - py) < e.radius + PLAYER.radius - 3) {
        this.killEnemy(e, false);
        this.playerHit();
      }
    }

    // Compact dead enemies occasionally.
    if (this.enemies.length > 64 && this.enemies.some((e) => !e.alive)) {
      let w = 0;
      for (const e of this.enemies) if (e.alive) this.enemies[w++] = e;
      this.enemies.length = w;
    }
  }

  private wellSupernova(e: Enemy): void {
    e.alive = false;
    this.particles.burst(e.x, e.y, 220, C.Red, 900, 1.4, 3);
    this.particles.ring(e.x, e.y, 80, C.Orange, 700, 0.8);
    this.grid.applyExplosive(e.x, e.y, 10, 500);
    this.shake(0.5);
    this.hooks.audio.play('bigExplode');
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const s = this.makeEnemy('seeker', e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30);
      s.vx = Math.cos(a) * 600;
      s.vy = Math.sin(a) * 600;
    }
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b) return;
    b.update(dt, this, this.px, this.py);
    if (b.dangerous && !this.dead && this.canBeHit() && Math.hypot(b.x - this.px, b.y - this.py) < b.radius + PLAYER.radius) {
      this.playerHit();
    }
    if (!b.alive) {
      // Final detonation.
      this.boss = null;
      // Flat reward plus a multiplier bonus, so bosses matter without dwarfing the run.
      const pts = 25000 * b.tier + this.mult * 1000;
      this.score += pts;
      this.pushText(b.x, b.y, `+${pts.toLocaleString()}`, C.Gold, 34);
      this.particles.burst(b.x, b.y, 900, C.Gold, 1400, 2, 3);
      this.particles.burst(b.x, b.y, 500, C.Magenta, 900, 1.6, 2);
      this.particles.ring(b.x, b.y, 160, C.White, 1100, 0.9);
      this.shockwaves.push({ x: b.x, y: b.y, r: 0, speed: 1600, max: 1400, color: C.Gold, width: 10, lethal: false });
      this.grid.applyExplosive(b.x, b.y, 30, 900);
      this.shake(1);
      this.hooks.renderer.flash = 1;
      this.hooks.renderer.flashColor = '255,210,120';
      this.targetTimeScale = 0.25;
      this.timeScale = 0.25;
      this.hooks.audio.play('bigExplode');
      this.clearEnemyBullets(true);
      for (let i = 0; i < 30; i++) this.dropShard(b.x, b.y, 500);
      this.dropPowerup(b.x - 40, b.y, 'weapon');
      this.dropPowerup(b.x + 40, b.y, this.lives < 3 ? 'life' : 'bomb');
    }
  }

  // ─────────────────────────────── bullets ───────────────────────────────

  private updateBullets(dt: number): void {
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      // Gravitational lensing: wells bend bullets.
      for (const a of this.attractors) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 200 * 200) {
          const d = Math.sqrt(d2) || 1;
          b.vx += (dx / d) * 5000 * dt;
          b.vy += (dy / d) * 5000 * dt;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.alive = false;
        continue;
      }
      if (b.x < -HALF_W || b.x > HALF_W || b.y < -HALF_H || b.y > HALF_H) {
        b.alive = false;
        const ix = clamp(b.x, -HALF_W, HALF_W);
        const iy = clamp(b.y, -HALF_H, HALF_H);
        this.particles.cone(ix, iy, Math.atan2(-b.vy, -b.vx), 1.6, 3, b.color, 260, 0.25);
        this.grid.applyExplosive(ix, iy, 0.4, 60);
        continue;
      }
      // Enemies.
      for (const e of this.enemyHash.query(b.x, b.y, b.radius)) {
        if (!e.active) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) > e.radius + b.radius) continue;
        this.damageEnemy(e, b.damage, b);
        if (b.pierce > 0) b.pierce--;
        else {
          b.alive = false;
          break;
        }
      }
      // Boss.
      const boss = this.boss;
      if (b.alive && boss && boss.vulnerable && Math.hypot(boss.x - b.x, boss.y - b.y) < boss.radius + b.radius) {
        b.alive = false;
        const phaseChanged = boss.damage(b.damage);
        this.particles.cone(b.x, b.y, Math.atan2(-b.vy, -b.vx), 1.2, 3, C.Gold, 300, 0.3);
        this.hooks.audio.play('hit', 0.7);
        this.score += 5 * this.mult;
        if (phaseChanged && boss.mode !== 'dying') {
          this.shake(0.5);
          this.grid.applyExplosive(boss.x, boss.y, 12, 600);
          this.clearEnemyBullets(true);
          this.hooks.renderer.flash = 0.6;
          this.hooks.renderer.flashColor = '255,80,160';
          this.hooks.audio.play('bigExplode');
          this.particles.ring(boss.x, boss.y, 120, C.Magenta, 900, 0.8);
        }
      }
    }

    for (const b of this.eBullets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || Math.abs(b.x) > HALF_W + 20 || Math.abs(b.y) > HALF_H + 20) {
        b.alive = false;
        continue;
      }
      if (!this.dead && this.canBeHit()) {
        const dx = b.x - this.px;
        const dy = b.y - this.py;
        // Generous hitbox: the ship core is smaller than its art.
        const rr = b.radius + PLAYER.radius * 0.55;
        if (dx * dx + dy * dy < rr * rr) {
          b.alive = false;
          this.playerHit();
        }
      }
    }
  }

  private damageEnemy(e: Enemy, dmg: number, b: Bullet): void {
    e.hp -= dmg;
    e.flash = 0.05;
    const back = Math.atan2(-b.vy, -b.vx);
    if (e.hp <= 0) this.killEnemy(e, true, Math.atan2(b.vy, b.vx));
    else {
      this.hooks.audio.play('hit');
      this.particles.cone(b.x, b.y, back, 1.2, 4, e.def.color, 280, 0.3);
      // Knockback.
      e.vx += b.vx * 0.04;
      e.vy += b.vy * 0.04;
    }
  }

  private killEnemy(e: Enemy, scored: boolean, dir?: number): void {
    if (!e.alive) return;
    e.alive = false;
    const def = e.def;
    const big = e.kind === 'well' || e.kind === 'gunner' || e.kind === 'splitter';
    const n = big ? 70 : 34;
    this.particles.burst(e.x, e.y, n, def.color, big ? 700 : 520, big ? 1.1 : 0.85);
    this.particles.burst(e.x, e.y, 8, C.White, 300, 0.4);
    if (dir !== undefined) this.particles.cone(e.x, e.y, dir, 0.7, 14, def.color, 700, 0.6);
    this.grid.applyExplosive(e.x, e.y, big ? 4 : 2, big ? 260 : 150);
    this.hooks.audio.play(e.kind === 'well' ? 'bigExplode' : 'explode', 0.8 + Math.random() * 0.5);
    this.shake(e.kind === 'well' ? 0.45 : 0.08);

    if (e.kind === 'splitter') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + Math.random();
        const m = this.makeEnemy('mini', e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12);
        m.vx = Math.cos(a) * 420;
        m.vy = Math.sin(a) * 420;
        m.speedMul = e.speedMul;
      }
    }
    if (e.kind === 'well') {
      this.shockwaves.push({ x: e.x, y: e.y, r: 0, speed: 900, max: 360, color: C.Red, width: 6, lethal: false });
    }
    if (!scored) return;

    this.kills++;
    this.combo++;
    this.comboT = SCORE.comboWindow;
    this.addScore(def.score, e.x, e.y, def.score >= 100);

    const shards = e.kind === 'mini' ? (Math.random() < 0.4 ? 1 : 0) : e.kind === 'well' ? 12 : big ? 4 : 2;
    for (let i = 0; i < shards; i++) this.dropShard(e.x, e.y, 220);

    // Power-up drops with a pity timer so droughts don't last.
    this.killsSinceDrop++;
    const base = e.kind === 'well' ? 0.5 : e.kind === 'gunner' ? 0.08 : 0.022;
    const pity = Math.max(0, this.killsSinceDrop - 40) * 0.004;
    if (Math.random() < base + pity) {
      this.killsSinceDrop = 0;
      this.dropPowerup(e.x, e.y);
    }
  }

  private addScore(base: number, x: number, y: number, popup: boolean): void {
    const pts = base * this.mult;
    this.score += pts;
    if (popup) this.pushText(x, y, pts.toLocaleString(), C.Gold, 18);
    if (!this.attract && this.score >= this.extraLifeAt) {
      this.extraLifeAt += 150000;
      this.lives++;
      this.hooks.audio.play('powerup');
      this.pushText(this.px, this.py - 30, t('pickupLife'), C.Green, 22);
    }
  }

  private pushText(x: number, y: number, text: string, color: number, size: number): void {
    this.texts.push({ x, y, text, color, life: 1.1, maxLife: 1.1, size });
  }

  private clearEnemyBullets(withSparks: boolean): void {
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      b.alive = false;
      if (withSparks) this.particles.spawn(b.x, b.y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.5, b.color, 3);
    }
  }

  // ─────────────────────────────── player events ───────────────────────────────

  private canBeHit(): boolean {
    return this.invuln <= 0 && this.dashT <= 0;
  }

  private playerHit(): void {
    if (this.shield) {
      this.shield = false;
      this.invuln = 1.2;
      this.particles.ring(this.px, this.py, 60, C.Cyan, 600, 0.6);
      this.grid.applyExplosive(this.px, this.py, 6, 300);
      this.hooks.audio.play('bomb');
      this.shake(0.4);
      this.clearNear(260);
      return;
    }
    this.lives--;
    this.mult = 1;
    this.weapon = Math.max(1, this.weapon - 1);
    this.rapidT = 0;
    this.hitstop = 0.12;
    this.targetTimeScale = this.timeScale = 0.3;
    this.particles.burst(this.px, this.py, 400, C.Cyan, 900, 1.6, 3);
    this.particles.burst(this.px, this.py, 200, C.White, 600, 1.0);
    this.particles.ring(this.px, this.py, 90, C.Magenta, 800, 0.8);
    this.grid.applyExplosive(this.px, this.py, 20, 700);
    this.shake(0.9);
    this.hooks.renderer.flash = 0.8;
    this.hooks.renderer.flashColor = '255,60,120';
    this.hooks.audio.play('playerHit');
    this.clearEnemyBullets(true);
    this.clearNear(340);
    if (this.lives <= 0) {
      this.dead = true;
      this.deadT = 0;
      this.targetTimeScale = this.timeScale = 0.2;
    } else {
      this.invuln = PLAYER.invulnAfterHit;
      this.pushText(this.px, this.py - 40, t('lifeLost'), C.Magenta, 22);
    }
  }

  /** Destroy (unscored) nearby enemies so a respawn is never an instant re-death. */
  private clearNear(radius: number): void {
    for (const e of this.enemies) {
      if (e.alive && Math.hypot(e.x - this.px, e.y - this.py) < radius) this.killEnemy(e, false);
    }
  }

  private detonateBomb(): void {
    if (this.bombs <= 0 || this.dead) return;
    this.bombs--;
    this.shockwaves.push({ x: this.px, y: this.py, r: 0, speed: 2400, max: 2400, color: C.Cyan, width: 18, lethal: true });
    this.particles.ring(this.px, this.py, 200, C.Cyan, 1600, 0.9);
    this.particles.ring(this.px, this.py, 120, C.White, 1100, 0.7);
    this.grid.applyExplosive(this.px, this.py, 40, 1400);
    this.hooks.renderer.flash = 0.9;
    this.hooks.renderer.flashColor = '120,240,255';
    this.shake(0.8);
    this.hooks.audio.play('bomb');
    this.invuln = Math.max(this.invuln, 0.6);
    if (this.boss?.vulnerable) this.boss.damage(30);
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i]!;
      s.r += s.speed * dt;
      if (s.lethal) {
        const r2 = s.r * s.r;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy < r2) this.killEnemy(e, e.spawning <= 0);
        }
        for (const b of this.eBullets) {
          if (!b.alive) continue;
          const dx = b.x - s.x;
          const dy = b.y - s.y;
          if (dx * dx + dy * dy < r2) {
            b.alive = false;
            this.particles.spawn(b.x, b.y, dx * 0.5, dy * 0.5, 0.4, b.color, 3);
          }
        }
      }
      if (s.r >= s.max) this.shockwaves.splice(i, 1);
    }
  }

  // ─────────────────────────────── pickups ───────────────────────────────

  private dropShard(x: number, y: number, speed: number): void {
    const p = new Pickup('shard');
    const a = Math.random() * TAU;
    const s = speed * (0.3 + Math.random() * 0.7);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = 7;
    p.radius = 7;
    this.pickups.push(p);
  }

  private dropPowerup(x: number, y: number, forced?: PickupKind): void {
    let kind: PickupKind;
    if (forced) kind = forced;
    else {
      kind = this.rng.weighted<PickupKind>([
        { item: 'weapon', weight: this.weapon < PLAYER.maxWeapon ? 4 : 0.5 },
        { item: 'shield', weight: this.shield ? 0.5 : 2.5 },
        { item: 'bomb', weight: this.bombs < 5 ? 2 : 0.3 },
        { item: 'rapid', weight: 2 },
        { item: 'magnet', weight: 1.5 },
        { item: 'life', weight: this.lives < 3 ? 0.8 : 0.2 },
      ]);
    }
    const p = new Pickup(kind);
    p.x = clamp(x, -HALF_W + 30, HALF_W - 30);
    p.y = clamp(y, -HALF_H + 30, HALF_H - 30);
    p.vx = (Math.random() - 0.5) * 60;
    p.vy = (Math.random() - 0.5) * 60;
    p.life = 11;
    p.radius = 18;
    this.pickups.push(p);
  }

  private updatePickups(dt: number): void {
    const magnetR = this.magnetT > 0 ? 2000 : 150;
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const dx = this.px - p.x;
      const dy = this.py - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!this.dead && p.kind === 'shard' && d < magnetR) {
        const pull = this.magnetT > 0 ? 1400 : 900;
        p.vx += (dx / d) * pull * dt * 4;
        p.vy += (dy / d) * pull * dt * 4;
        const sp = Math.hypot(p.vx, p.vy);
        const max = this.magnetT > 0 ? 1300 : 800;
        if (sp > max) (p.vx *= max / sp), (p.vy *= max / sp);
      } else {
        const k = Math.exp(-(p.kind === 'shard' ? 3 : 0.5) * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (Math.abs(p.x) > HALF_W - 8) (p.vx *= -1), (p.x = clamp(p.x, -HALF_W + 8, HALF_W - 8));
      if (Math.abs(p.y) > HALF_H - 8) (p.vy *= -1), (p.y = clamp(p.y, -HALF_H + 8, HALF_H - 8));

      if (!this.dead && d < PLAYER.radius + p.radius) {
        p.alive = false;
        this.collect(p);
      }
    }
    if (this.pickups.length > 200) {
      let w = 0;
      for (const p of this.pickups) if (p.alive) this.pickups[w++] = p;
      this.pickups.length = w;
    }
  }

  private collect(p: Pickup): void {
    const col = pickupColor(p.kind);
    if (p.kind === 'shard') {
      this.mult = Math.min(SCORE.maxMultiplier, this.mult + SCORE.multiplierPerShard);
      this.maxMult = Math.max(this.maxMult, this.mult);
      this.hooks.audio.play('pickup', 1 + Math.min(1.5, this.mult / 200));
      this.particles.burst(p.x, p.y, 3, C.Green, 120, 0.3);
      return;
    }
    this.hooks.audio.play('powerup');
    this.particles.ring(p.x, p.y, 40, col, 400, 0.5);
    let label = '';
    switch (p.kind) {
      case 'weapon':
        this.weapon = Math.min(PLAYER.maxWeapon, this.weapon + 1);
        label = t('pickupWeapon');
        break;
      case 'shield':
        this.shield = true;
        label = t('pickupShield');
        break;
      case 'bomb':
        this.bombs = Math.min(9, this.bombs + 1);
        label = t('pickupBomb');
        break;
      case 'rapid':
        this.rapidT = 9;
        label = t('pickupRapid');
        break;
      case 'magnet':
        this.magnetT = 10;
        label = t('pickupMagnet');
        break;
      case 'life':
        this.lives++;
        label = t('pickupLife');
        break;
    }
    this.pushText(p.x, p.y - 26, label, col, 20);
  }

  private updateTexts(dt: number): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i]!;
      tx.life -= dt;
      tx.y -= 40 * dt;
      if (tx.life <= 0) this.texts.splice(i, 1);
    }
  }

  // ─────────────────────────────── AI pilot (attract mode) ───────────────────────────────

  aiControls(): Controls {
    let fx = -this.px * 0.0009;
    let fy = -this.py * 0.0009;
    let nearest: Enemy | null = null;
    let nd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = this.px - e.x;
      const dy = this.py - e.y;
      const d2 = dx * dx + dy * dy + 1;
      if (e.active && d2 < nd) {
        nd = d2;
        nearest = e;
      }
      if (d2 < 340 * 340) {
        fx += (dx / d2) * 60;
        fy += (dy / d2) * 60;
      }
    }
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      const dx = this.px - b.x;
      const dy = this.py - b.y;
      const d2 = dx * dx + dy * dy + 1;
      if (d2 < 200 * 200) {
        fx += (dx / d2) * 40;
        fy += (dy / d2) * 40;
      }
    }
    // Lazy orbit when nothing is around.
    fx += Math.cos(this.time * 0.4) * 0.08;
    fy += Math.sin(this.time * 0.5) * 0.08;
    const l = len(fx, fy) || 1;
    const m = Math.min(1, l * 6);
    let aim = this.pAngle;
    if (nearest) {
      const lead = Math.sqrt(nd) / PLAYER.bulletSpeed;
      aim = Math.atan2(nearest.y + nearest.vy * lead - this.py, nearest.x + nearest.vx * lead - this.px);
    }
    return { moveX: (fx / l) * m, moveY: (fy / l) * m, aim, firing: nearest !== null, bomb: false, dash: false };
  }

  // ─────────────────────────────── render ───────────────────────────────

  render(r: Renderer): void {
    r.beginWorld(BG);
    const g = r.g;
    const time = this.time;

    this.grid.draw(g, time);

    for (const p of this.pickups) if (p.alive) drawPickup(g, p, time);

    // Enemy bullets: batched glowing orbs.
    for (const col of [C.Magenta, C.Orange, C.Violet]) {
      g.beginPath();
      let any = false;
      for (const b of this.eBullets) {
        if (!b.alive || b.color !== col) continue;
        any = true;
        g.moveTo(b.x + b.radius + 3, b.y);
        g.arc(b.x, b.y, b.radius + 3, 0, TAU);
      }
      if (any) {
        g.fillStyle = rgb(col, 0.55);
        g.fill();
      }
    }
    g.beginPath();
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      g.moveTo(b.x + b.radius * 0.5, b.y);
      g.arc(b.x, b.y, b.radius * 0.5, 0, TAU);
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fill();

    for (const e of this.enemies) if (e.alive) drawEnemy(g, e, time);
    this.boss?.draw(g, time);

    // Player bullets: streaks.
    for (const col of [C.Gold, C.Orange]) {
      g.beginPath();
      for (const b of this.pBullets) {
        if (!b.alive || b.color !== col) continue;
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
      }
      g.strokeStyle = rgb(col, 0.9);
      g.lineWidth = 5;
      g.stroke();
    }
    g.beginPath();
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    }
    g.strokeStyle = 'rgba(255,255,240,1)';
    g.lineWidth = 2;
    g.stroke();

    // Player.
    if (!this.dead && !(this.invuln > 0 && !this.attract && Math.sin(time * 40) < 0)) {
      drawShip(g, this.px, this.py, this.pAngle, this.dashT > 0 ? C.White : C.Cyan);
      if (this.shield) {
        g.beginPath();
        g.arc(this.px, this.py, 28 + Math.sin(time * 8) * 2, 0, TAU);
        g.strokeStyle = rgb(C.Cyan, 0.5);
        g.lineWidth = 2.5;
        g.stroke();
      }
    }

    this.particles.draw(g);

    for (const s of this.shockwaves) {
      const k = 1 - s.r / s.max;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, TAU);
      g.strokeStyle = rgb(s.color, 0.8 * k);
      g.lineWidth = s.width * k + 2;
      g.stroke();
    }

    // Floating score text.
    g.globalCompositeOperation = 'source-over';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const tx of this.texts) {
      const a = Math.min(1, tx.life / tx.maxLife * 2);
      g.font = `700 ${tx.size}px Orbitron, system-ui, sans-serif`;
      g.fillStyle = rgb(tx.color, a);
      g.fillText(tx.text, tx.x, tx.y);
    }
    g.globalCompositeOperation = 'lighter';
  }
}
