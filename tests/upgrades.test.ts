import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { dictionaries } from '../src/game/i18n';
import { PERMANENT_IDS, UPGRADES, cost, derive, emptyLevels, isMaxed, rerollCost, rollOffers, shopAfterWave } from '../src/game/upgrades';

describe('upgrade shop', () => {
  it('prices rise with each level and are multiples of 5', () => {
    const l = emptyLevels();
    for (const id of PERMANENT_IDS) {
      let prev = 0;
      for (let lvl = 0; lvl < UPGRADES[id].max; lvl++) {
        l[id] = lvl;
        const c = cost(id, l);
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
    }
  });

  it('offers are distinct and never include maxed upgrades', () => {
    const l = emptyLevels();
    l.drone = UPGRADES.drone.max;
    l.greed = UPGRADES.greed.max;
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const offers = rollOffers(rng, l, 4);
      expect(new Set(offers).size).toBe(offers.length);
      expect(offers).not.toContain('drone');
      expect(offers).not.toContain('greed');
      for (const o of offers) expect(UPGRADES[o].consumable).toBe(false);
    }
  });

  it('shrinks gracefully when almost everything is maxed', () => {
    const l = emptyLevels();
    for (const id of PERMANENT_IDS) l[id] = UPGRADES[id].max;
    l.speed = 0;
    expect(rollOffers(new Rng(1), l, 4)).toEqual(['speed']);
    expect(isMaxed('fireRate', l)).toBe(true);
  });

  it('a reroll prefers new offers but tops up with old ones', () => {
    const l = emptyLevels();
    const first = rollOffers(new Rng(9), l, 4);
    const second = rollOffers(new Rng(10), l, 4, first);
    expect(second).toHaveLength(4);
    const fresh = second.filter((id) => !first.includes(id));
    expect(fresh.length).toBe(Math.min(4, PERMANENT_IDS.length - 4));
  });

  it('reroll cost escalates', () => {
    expect(rerollCost(1)).toBeGreaterThan(rerollCost(0));
  });

  it('opens after the midpoint and boss waves', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10, 12].filter(shopAfterWave)).toEqual([2, 5, 7, 10, 12]);
  });

  it('derives sensible stats', () => {
    const base = derive(emptyLevels());
    expect(base).toMatchObject({ fireIntervalMul: 1, damage: 1, speedMul: 1, drones: 0, shieldRegen: 0, creditsPerShard: 1 });
    const l = emptyLevels();
    l.fireRate = 5;
    l.shieldGen = 3;
    l.drone = 2;
    const d = derive(l);
    expect(d.fireIntervalMul).toBeLessThan(0.6);
    expect(d.shieldRegen).toBe(18);
    expect(d.drones).toBe(2);
  });

  it('every upgrade has translated name and description', () => {
    for (const u of Object.values(UPGRADES)) {
      for (const dict of Object.values(dictionaries)) {
        expect(dict[u.name]).toBeTruthy();
        expect(dict[u.desc]).toBeTruthy();
      }
    }
  });
});
