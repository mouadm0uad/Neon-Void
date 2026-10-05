/**
 * Roguelite upgrade shop. Shards double as currency; between waves the player
 * buys upgrades that last for the rest of the run. Pure data + pure functions,
 * so pricing and offer rolls are unit-tested.
 */
import { Rng } from '../engine/rng';
import type { I18nKey } from './i18n';

export type UpgradeId = 'fireRate' | 'damage' | 'speed' | 'dash' | 'magnet' | 'drone' | 'shieldGen' | 'greed' | 'bomb' | 'repair';

export interface UpgradeDef {
  id: UpgradeId;
  name: I18nKey;
  desc: I18nKey;
  /** Max level; consumables use Infinity. */
  max: number;
  baseCost: number;
  /** Price multiplier per level owned (or per purchase for consumables). */
  growth: number;
  consumable: boolean;
  color: number;
  glyph: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  fireRate: {
    id: 'fireRate',
    name: 'upFireRate',
    desc: 'upFireRateDesc',
    max: 5,
    baseCost: 40,
    growth: 1.6,
    consumable: false,
    color: 3,
    glyph: '≫',
  },
  damage: {
    id: 'damage',
    name: 'upDamage',
    desc: 'upDamageDesc',
    max: 4,
    baseCost: 60,
    growth: 1.7,
    consumable: false,
    color: 6,
    glyph: '✦',
  },
  speed: { id: 'speed', name: 'upSpeed', desc: 'upSpeedDesc', max: 4, baseCost: 30, growth: 1.6, consumable: false, color: 1, glyph: '➤' },
  dash: { id: 'dash', name: 'upDash', desc: 'upDashDesc', max: 3, baseCost: 35, growth: 1.7, consumable: false, color: 1, glyph: '⇥' },
  magnet: {
    id: 'magnet',
    name: 'upMagnet',
    desc: 'upMagnetDesc',
    max: 3,
    baseCost: 25,
    growth: 1.6,
    consumable: false,
    color: 5,
    glyph: '◎',
  },
  drone: { id: 'drone', name: 'upDrone', desc: 'upDroneDesc', max: 3, baseCost: 120, growth: 1.8, consumable: false, color: 4, glyph: '◇' },
  shieldGen: {
    id: 'shieldGen',
    name: 'upShieldGen',
    desc: 'upShieldGenDesc',
    max: 3,
    baseCost: 90,
    growth: 1.7,
    consumable: false,
    color: 1,
    glyph: '⬡',
  },
  greed: { id: 'greed', name: 'upGreed', desc: 'upGreedDesc', max: 2, baseCost: 70, growth: 2, consumable: false, color: 4, glyph: '$' },
  bomb: {
    id: 'bomb',
    name: 'upBomb',
    desc: 'upBombDesc',
    max: Infinity,
    baseCost: 35,
    growth: 1.3,
    consumable: true,
    color: 2,
    glyph: 'B',
  },
  repair: {
    id: 'repair',
    name: 'upRepair',
    desc: 'upRepairDesc',
    max: Infinity,
    baseCost: 150,
    growth: 1.6,
    consumable: true,
    color: 4,
    glyph: '+',
  },
};

export const PERMANENT_IDS = (Object.keys(UPGRADES) as UpgradeId[]).filter((id) => !UPGRADES[id].consumable);
export const CONSUMABLE_IDS = (Object.keys(UPGRADES) as UpgradeId[]).filter((id) => UPGRADES[id].consumable);

/** Levels owned (or times bought, for consumables). */
export type Levels = Record<UpgradeId, number>;

export const emptyLevels = (): Levels => Object.fromEntries((Object.keys(UPGRADES) as UpgradeId[]).map((k) => [k, 0])) as Levels;

export function cost(id: UpgradeId, levels: Levels): number {
  const d = UPGRADES[id];
  return Math.round((d.baseCost * Math.pow(d.growth, levels[id])) / 5) * 5;
}

export const isMaxed = (id: UpgradeId, levels: Levels): boolean => levels[id] >= UPGRADES[id].max;

/** Rerolls get pricier each time within one shop visit. */
export const rerollCost = (rerollsThisVisit: number): number => 15 + rerollsThisVisit * 10;

/** Pick up to `n` distinct, non-maxed permanent upgrades. */
export function rollOffers(rng: Rng, levels: Levels, n = 4, exclude: readonly UpgradeId[] = []): UpgradeId[] {
  const pool = PERMANENT_IDS.filter((id) => !isMaxed(id, levels) && !exclude.includes(id));
  // Fisher–Yates on the pool.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picked = pool.slice(0, n);
  // Top up with excluded ones if the pool ran dry, so rerolls never shrink the shop.
  if (picked.length < n) {
    for (const id of exclude) if (picked.length < n && !isMaxed(id, levels) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

/** Shop opens after the boss and at the midpoint of every 5-wave cycle. */
export const shopAfterWave = (n: number): boolean => n > 0 && (n % 5 === 0 || n % 5 === 2);

/** Derived combat stats from upgrade levels. */
export interface Derived {
  fireIntervalMul: number;
  damage: number;
  speedMul: number;
  dashCdMul: number;
  magnetRadius: number;
  drones: number;
  /** Seconds to regenerate a shield; 0 = no generator. */
  shieldRegen: number;
  creditsPerShard: number;
}

export function derive(l: Levels): Derived {
  return {
    fireIntervalMul: 1 / (1 + 0.14 * l.fireRate),
    damage: 1 + 0.25 * l.damage,
    speedMul: 1 + 0.08 * l.speed,
    dashCdMul: Math.pow(0.8, l.dash),
    magnetRadius: 150 * (1 + 0.6 * l.magnet),
    drones: l.drone,
    shieldRegen: l.shieldGen === 0 ? 0 : [0, 40, 28, 18][l.shieldGen]!,
    creditsPerShard: 1 + l.greed,
  };
}
