import { describe, expect, it } from 'vitest';
import { angleDiff, clamp, circlesOverlap, normalize, rotateToward, vec } from '../src/engine/math';
import { Rng } from '../src/engine/rng';
import { SpatialHash } from '../src/engine/spatialHash';
import { dictionaries } from '../src/game/i18n';
import { ENEMY_DEFS } from '../src/game/entities';
import { isBossWave, planWave, waveBudget } from '../src/game/waves';

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
  it('normalizes and handles zero vectors', () => {
    const v = normalize(vec(), 3, 4);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
    expect(normalize(vec(), 0, 0)).toEqual({ x: 0, y: 0 });
  });
  it('computes shortest angle difference across the wrap', () => {
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(-3, 3)).toBeCloseTo(6 - Math.PI * 2);
  });
  it('rotates toward a target without overshooting', () => {
    expect(rotateToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(rotateToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });
  it('detects circle overlap', () => {
    expect(circlesOverlap(0, 0, 5, 9, 0, 5)).toBe(true);
    expect(circlesOverlap(0, 0, 5, 11, 0, 5)).toBe(false);
  });
});

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });
});

describe('SpatialHash', () => {
  const item = (x: number, y: number, radius = 5) => ({ x, y, radius, hashMark: 0 });

  it('finds nearby items and ignores distant ones', () => {
    const h = new SpatialHash<ReturnType<typeof item>>(50);
    const near = item(10, 10);
    const far = item(900, 900);
    h.insert(near);
    h.insert(far);
    const found = h.query(0, 0, 20);
    expect(found).toContain(near);
    expect(found).not.toContain(far);
  });

  it('returns each item once even when it spans several cells', () => {
    const h = new SpatialHash<ReturnType<typeof item>>(10);
    const big = item(0, 0, 40);
    h.insert(big);
    expect(h.query(0, 0, 40).filter((i) => i === big)).toHaveLength(1);
  });

  it('works with negative coordinates and clears', () => {
    const h = new SpatialHash<ReturnType<typeof item>>(32);
    const a = item(-500, -300);
    h.insert(a);
    expect(h.query(-500, -300, 1)).toContain(a);
    h.clear();
    expect(h.query(-500, -300, 1)).toHaveLength(0);
  });
});

describe('wave director', () => {
  it('flags every fifth wave as a boss wave', () => {
    expect([1, 4, 5, 6, 10, 15].map(isBossWave)).toEqual([false, false, true, false, true, true]);
  });

  it('budget grows monotonically', () => {
    for (let n = 1; n < 40; n++) expect(waveBudget(n + 1)).toBeGreaterThan(waveBudget(n));
  });

  it('is deterministic for a seed', () => {
    expect(planWave(7, 1234)).toEqual(planWave(7, 1234));
  });

  it('spends (almost) exactly its budget and respects unlocks', () => {
    for (let n = 1; n <= 30; n++) {
      if (isBossWave(n)) continue;
      const plan = planWave(n, 99);
      const spent = plan.groups.reduce((s, g) => s + g.count * ENEMY_DEFS[g.kind].cost, 0);
      expect(spent).toBeLessThanOrEqual(waveBudget(n));
      expect(spent).toBeGreaterThan(waveBudget(n) * 0.85);
      for (const g of plan.groups) expect(ENEMY_DEFS[g.kind].unlock).toBeLessThanOrEqual(n);
    }
  });

  it('schedules groups in chronological order', () => {
    const plan = planWave(12, 5);
    for (let i = 1; i < plan.groups.length; i++) expect(plan.groups[i]!.at).toBeGreaterThan(plan.groups[i - 1]!.at);
  });
});

describe('i18n', () => {
  it('has a non-empty translation for every key in every language', () => {
    const keys = Object.keys(dictionaries.en);
    for (const lang of Object.keys(dictionaries) as (keyof typeof dictionaries)[]) {
      expect(Object.keys(dictionaries[lang]).sort()).toEqual([...keys].sort());
      for (const k of keys) expect(dictionaries[lang][k as keyof typeof dictionaries.en].length).toBeGreaterThan(0);
    }
  });
});
