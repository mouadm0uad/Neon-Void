/**
 * Wave director. Pure & deterministic given a seed, so it is unit-tested.
 * Each wave gets a point budget that grows with the wave number; enemies are
 * bought with that budget in themed groups ("formations") released over time.
 * Every 5th wave is a boss wave.
 */
import { Rng } from '../engine/rng';
import { ENEMY_DEFS, type EnemyKind } from './entities';

export type Formation = 'cluster' | 'ring' | 'edges' | 'scatter' | 'line';

export interface SpawnGroup {
  /** Seconds after wave start. */
  at: number;
  kind: EnemyKind;
  count: number;
  formation: Formation;
}

export interface WavePlan {
  number: number;
  boss: boolean;
  groups: SpawnGroup[];
  /** Global speed multiplier — difficulty creeps up. */
  speedMul: number;
}

export const isBossWave = (n: number): boolean => n > 0 && n % 5 === 0;

export const waveBudget = (n: number): number => Math.round(10 + n * 5 + Math.pow(n, 1.35));

const SPAWNABLE: EnemyKind[] = ['drifter', 'seeker', 'splitter', 'dart', 'gunner', 'well'];

const PREFERRED_FORMATION: Record<EnemyKind, Formation[]> = {
  drifter: ['scatter', 'edges', 'cluster'],
  seeker: ['ring', 'cluster', 'edges', 'line'],
  splitter: ['cluster', 'scatter'],
  mini: ['cluster'],
  dart: ['line', 'cluster', 'edges'],
  gunner: ['edges', 'scatter'],
  well: ['scatter'],
};

export function planWave(n: number, seed: number): WavePlan {
  const rng = new Rng(seed * 7919 + n * 104729);
  const speedMul = Math.min(1.6, 1 + (n - 1) * 0.025);

  if (isBossWave(n)) {
    // Boss + light escorts that ramp with tier.
    const tier = n / 5;
    const groups: SpawnGroup[] = [];
    for (let i = 0; i < tier; i++) {
      groups.push({ at: 6 + i * 7, kind: rng.pick(['seeker', 'drifter'] as const), count: 6 + tier * 2, formation: 'edges' });
    }
    return { number: n, boss: true, groups, speedMul };
  }

  const available = SPAWNABLE.filter((k) => ENEMY_DEFS[k].unlock <= n);
  let budget = waveBudget(n);
  const groups: SpawnGroup[] = [];
  let at = 0.6;
  let wells = 0;

  while (budget > 0) {
    const options = available
      .filter((k) => ENEMY_DEFS[k].cost <= budget)
      .filter((k) => k !== 'well' || wells < 1 + Math.floor(n / 8))
      .map((k) => ({
        item: k,
        // Newly unlocked enemies get a spotlight in their debut wave.
        weight: (ENEMY_DEFS[k].unlock === n ? 4 : 1) * (k === 'well' ? 0.5 : 1),
      }));
    if (options.length === 0) break;
    const kind = rng.weighted(options);
    const cost = ENEMY_DEFS[kind].cost;
    const maxCount = Math.max(1, Math.floor(budget / cost));
    const ideal = kind === 'well' ? 1 : kind === 'gunner' ? rng.int(1, 3) : rng.int(3, 8 + Math.floor(n / 3));
    const count = Math.min(maxCount, ideal);
    if (kind === 'well') wells += count;
    budget -= count * cost;
    groups.push({ at, kind, count, formation: rng.pick(PREFERRED_FORMATION[kind]) });
    at += rng.range(1.2, 2.6) * Math.max(0.55, 1 - n * 0.02);
  }

  return { number: n, boss: false, groups, speedMul };
}
