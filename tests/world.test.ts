/**
 * Headless simulation tests: the World runs in Node with stubbed renderer/audio
 * hooks, so gameplay rules and regressions are tested without a browser.
 */
import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../src/engine/audio';
import { Music } from '../src/engine/music';
import type { Renderer } from '../src/engine/renderer';
import type { Synth } from '../src/engine/synth';
import { World, type Controls, type RunStats } from '../src/game/world';

const STEP = 1 / 120;
const idle: Controls = { moveX: 0, moveY: 0, aim: 0, firing: false, bomb: false, dash: false };

function makeWorld() {
  const sounds: string[] = [];
  const events = { over: [] as RunStats[], shop: [] as number[] };
  const renderer = {
    camera: { x: 0, y: 0, zoom: 1, trauma: 0, shakeX: 0, shakeY: 0, shakeRot: 0 },
    viewHalf: { w: 640, h: 400 },
    flash: 0,
    flashColor: '',
    update() {},
    addTrauma() {},
  } as unknown as Renderer;
  const audio = { play: (n: string) => sounds.push(n), intensity: 0 } as unknown as AudioEngine;
  const world = new World({
    audio,
    renderer,
    shakeScale: () => 1,
    onGameOver: (s) => events.over.push(s),
    onShop: (n) => events.shop.push(n),
  });
  const run = (seconds: number, c: Controls | (() => Controls) = idle) => {
    for (let i = 0; i < seconds / STEP; i++) world.update(STEP, typeof c === 'function' ? c() : c);
  };
  return { world, sounds, events, run };
}

/** Jump straight to the end of wave `n` with an empty arena. */
function clearWave(world: World, n: number) {
  const w = world as unknown as Record<string, unknown>;
  world.wave = n;
  w.plan = { number: n, boss: false, groups: [], speedMul: 1 };
  w.groupIdx = 0;
  w.intermission = 0;
  world.enemies.length = 0;
}

describe('World simulation', () => {
  it('survives a long AI-piloted run without NaNs', () => {
    const { world, run } = makeWorld();
    world.reset(false);
    world.invuln = 1e9;
    for (let t = 0; t < 180; t += 1) {
      world.invuln = 1e9;
      if (world.waitingShop) world.closeShop();
      run(1, () => world.aiControls());
    }
    expect(world.wave).toBeGreaterThan(3);
    expect(Number.isFinite(world.px) && Number.isFinite(world.py) && Number.isFinite(world.score)).toBe(true);
    for (const e of world.enemies) if (e.alive) expect(Number.isFinite(e.x + e.y)).toBe(true);
  });

  it('opens the upgrade bay after wave 2 and resumes after closing it', () => {
    const { world, events, run } = makeWorld();
    world.reset(false);
    run(0.1);
    clearWave(world, 2);
    run(3);
    expect(events.shop).toEqual([3]);
    expect(world.waitingShop).toBe(true);
    world.closeShop();
    run(2);
    expect(world.wave).toBe(3);
  });

  it('never opens the shop in attract mode', () => {
    const { world, events, run } = makeWorld();
    world.reset(true);
    run(0.1);
    clearWave(world, 2);
    run(3);
    expect(events.shop).toEqual([]);
  });

  it('charges for upgrades and refuses when broke or maxed', () => {
    const { world } = makeWorld();
    world.reset(false);
    world.credits = 100;
    expect(world.buy('speed')).toBe(true);
    expect(world.credits).toBe(70);
    expect(world.levels.speed).toBe(1);
    expect(world.derived.speedMul).toBeGreaterThan(1);
    world.credits = 0;
    expect(world.buy('drone')).toBe(false);
    world.credits = 1e6;
    for (let i = 0; i < 10; i++) world.buy('greed');
    expect(world.levels.greed).toBe(2);
  });

  it('awards a flawless wave bonus and can grant an extra life from it', () => {
    const { world, run } = makeWorld();
    world.reset(false);
    run(0.1);
    world.score = 74_000;
    const lives = world.lives;
    clearWave(world, 1);
    run(0.1);
    expect(world.score).toBe(74_000 + 1000); // 500 × wave 1 × 2 (flawless)
    expect(world.lives).toBe(lives + 1);
  });

  it('silences the boss once the player is dead', () => {
    const { world, sounds, run } = makeWorld();
    world.reset(false);
    run(0.1);
    clearWave(world, 4);
    run(6);
    expect(world.boss).not.toBeNull();
    world.invuln = 0;
    world.lives = 1;
    (world as unknown as { playerHit(): void }).playerHit();
    expect(world.dead).toBe(true);
    sounds.length = 0;
    const bullets = world.eBullets.filter((b) => b.alive).length;
    run(5);
    expect(sounds.filter((s) => s === 'enemyShoot')).toHaveLength(0);
    expect(world.eBullets.filter((b) => b.alive).length).toBeLessThanOrEqual(bullets);
  });

  it('reports game over exactly once', () => {
    const { world, events, run } = makeWorld();
    world.reset(false);
    run(0.1);
    world.invuln = 0;
    world.lives = 1;
    (world as unknown as { playerHit(): void }).playerHit();
    run(6);
    expect(events.over).toHaveLength(1);
  });
});

describe('Music song switching', () => {
  const music = () => new Music({} as Synth, {} as never);

  it('switches immediately from silence and queues otherwise', () => {
    const m = music();
    m.setSong('game');
    expect(m.song).toBe('game');
    m.setSong('boss');
    expect(m.song).toBe('game');
  });

  it('cancels a queued switch when asked for the current song again', () => {
    const m = music() as unknown as { setSong(s: string): void; song: string; queued: string | null };
    m.setSong('game');
    m.setSong('boss');
    m.setSong('game');
    expect(m.queued).toBeNull();
    expect(m.song).toBe('game');
  });
});
