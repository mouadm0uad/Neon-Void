/** Tunables and the neon palette. Everything gameplay-feel-related lives here. */

export const ARENA = { w: 1800, h: 1120 } as const;
export const HALF_W = ARENA.w / 2;
export const HALF_H = ARENA.h / 2;

export const BG = '#04020c';

/** Palette indices are used by the particle system for batched draws. */
export const PALETTE = [
  [255, 255, 255], // 0 white
  [0, 240, 255], // 1 cyan
  [255, 46, 160], // 2 magenta
  [255, 200, 40], // 3 gold
  [90, 255, 120], // 4 green
  [170, 90, 255], // 5 violet
  [255, 110, 40], // 6 orange
  [255, 60, 60], // 7 red
  [80, 140, 255], // 8 blue
] as const;

export const enum C {
  White = 0,
  Cyan = 1,
  Magenta = 2,
  Gold = 3,
  Green = 4,
  Violet = 5,
  Orange = 6,
  Red = 7,
  Blue = 8,
}

export const rgb = (i: number, a = 1): string => {
  const p = PALETTE[i]!;
  return a >= 1 ? `rgb(${p[0]},${p[1]},${p[2]})` : `rgba(${p[0]},${p[1]},${p[2]},${a})`;
};

export const PLAYER = {
  radius: 13,
  accel: 5200,
  maxSpeed: 520,
  friction: 9,
  fireInterval: 0.085,
  bulletSpeed: 1350,
  dashSpeed: 1500,
  dashTime: 0.16,
  dashCooldown: 0.9,
  invulnAfterHit: 2.5,
  startLives: 3,
  startBombs: 3,
  maxWeapon: 5,
} as const;

export const SCORE = {
  multiplierPerShard: 1,
  maxMultiplier: 999,
  comboWindow: 1.25,
} as const;
