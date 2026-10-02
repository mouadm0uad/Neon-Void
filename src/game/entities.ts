/** Plain data entities. Behaviour lives in the systems that update them. */
import type { HashItem } from '../engine/spatialHash';

export type EnemyKind = 'drifter' | 'seeker' | 'dart' | 'splitter' | 'mini' | 'gunner' | 'well';

export interface EnemyDef {
  hp: number;
  radius: number;
  speed: number;
  score: number;
  color: number;
  /** Spawn budget cost used by the wave director. */
  cost: number;
  /** First wave this enemy can appear in. */
  unlock: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  drifter: { hp: 1, radius: 16, speed: 90, score: 25, color: 5, cost: 1, unlock: 1 },
  seeker: { hp: 1, radius: 15, speed: 210, score: 50, color: 1, cost: 2, unlock: 1 },
  splitter: { hp: 3, radius: 20, speed: 120, score: 75, color: 2, cost: 4, unlock: 2 },
  mini: { hp: 1, radius: 9, speed: 300, score: 10, color: 2, cost: 1, unlock: 99 },
  dart: { hp: 1, radius: 15, speed: 260, score: 100, color: 4, cost: 4, unlock: 3 },
  gunner: { hp: 4, radius: 18, speed: 160, score: 150, color: 6, cost: 6, unlock: 4 },
  well: { hp: 16, radius: 24, speed: 30, score: 300, color: 7, cost: 12, unlock: 6 },
};

export class Enemy implements HashItem {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  radius = 16;
  hp = 1;
  maxHp = 1;
  angle = 0;
  age = 0;
  /** Seconds of spawn telegraph remaining; enemy is harmless while > 0. */
  spawning = 0;
  /** Hit flash timer. */
  flash = 0;
  cooldown = 0;
  /** Wells: how many enemies swallowed. */
  fed = 0;
  wanderAngle = 0;
  alive = true;
  hashMark = 0;
  speedMul = 1;

  constructor(public kind: EnemyKind) {}

  get def(): EnemyDef {
    return ENEMY_DEFS[this.kind];
  }

  get active(): boolean {
    return this.alive && this.spawning <= 0;
  }
}

export class Bullet implements HashItem {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  radius = 5;
  life = 0;
  damage = 1;
  alive = false;
  hashMark = 0;
  color = 3;
  /** Remaining enemies this bullet can pass through. */
  pierce = 0;
}

export type PickupKind = 'shard' | 'weapon' | 'shield' | 'bomb' | 'rapid' | 'life' | 'magnet';

export class Pickup {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  life = 0;
  alive = true;
  radius = 8;
  constructor(public kind: PickupKind) {}
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: number;
  life: number;
  maxLife: number;
  size: number;
}
