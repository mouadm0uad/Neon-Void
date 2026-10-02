/**
 * App shell: wires engine + world + DOM menus together and runs the state
 * machine  title → playing ⇄ paused → over → (playing | title).
 */
import './style.css';
import { AudioEngine } from './engine/audio';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { Renderer, type BloomQuality } from './engine/renderer';
import { load, save } from './engine/storage';
import { Enemy, type EnemyKind } from './game/entities';
import { drawHud } from './game/hud';
import { detectLang, setLang, t, type I18nKey, type Lang } from './game/i18n';
import { drawEnemy } from './game/shapes';
import { World, type Controls, type RunStats } from './game/world';

type State = 'title' | 'playing' | 'paused' | 'over';
type Screen = 'title' | 'howto' | 'settings' | 'pause' | 'over' | null;

interface Settings {
  lang: Lang;
  sfx: number;
  music: number;
  bloom: BloomQuality;
  shake: number;
  fps: boolean;
}

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const settings = load<Settings>('settings', {
  lang: detectLang(),
  sfx: 0.8,
  music: 0.55,
  bloom: 'high',
  shake: reducedMotion ? 0.3 : 1,
  fps: false,
});
let best = load<number>('best', 0);

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new AudioEngine();

let state: State = 'title';
let screen: Screen = 'title';
let returnScreen: Screen = 'title';
let overAt = 0;

const world = new World({
  audio,
  renderer,
  shakeScale: () => settings.shake,
  onGameOver: (s) => onGameOver(s),
});
world.reset(true);

// ───────────────────────────── settings & i18n ─────────────────────────────

function applySettings(): void {
  setLang(settings.lang);
  renderer.bloom = settings.bloom;
  renderer.resize();
  audio.sfxVolume = settings.sfx;
  audio.musicVolume = settings.music;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as I18nKey);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === settings.lang);
  });
  const form = $<HTMLFormElement>('#settings-form');
  (form.elements.namedItem('lang') as HTMLSelectElement).value = settings.lang;
  (form.elements.namedItem('sfx') as HTMLInputElement).value = String(settings.sfx);
  (form.elements.namedItem('music') as HTMLInputElement).value = String(settings.music);
  (form.elements.namedItem('bloom') as HTMLSelectElement).value = settings.bloom;
  (form.elements.namedItem('shake') as HTMLInputElement).value = String(settings.shake);
  (form.elements.namedItem('fps') as HTMLInputElement).checked = settings.fps;
  $('#best-score').textContent = best.toLocaleString();
  buildLegend();
  save('settings', settings);
}

$<HTMLFormElement>('#settings-form').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  switch (el.name) {
    case 'lang':
      settings.lang = el.value as Lang;
      break;
    case 'sfx':
      settings.sfx = Number(el.value);
      audio.play('select');
      break;
    case 'music':
      settings.music = Number(el.value);
      break;
    case 'bloom':
      settings.bloom = el.value as BloomQuality;
      break;
    case 'shake':
      settings.shake = Number(el.value);
      renderer.addTrauma(0.5 * settings.shake);
      break;
    case 'fps':
      settings.fps = el.checked;
      break;
  }
  applySettings();
});

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    settings.lang = b.dataset.lang as Lang;
    audio.play('select');
    applySettings();
  }),
);

/** Enemy gallery on the How-to screen, drawn with the real game renderer code. */
function buildLegend(): void {
  const host = $('#legend');
  host.innerHTML = '';
  const kinds: EnemyKind[] = ['drifter', 'seeker', 'splitter', 'dart', 'gunner', 'well'];
  const names: Record<Lang, Record<EnemyKind, string>> = {
    en: { drifter: 'Drifter', seeker: 'Seeker', splitter: 'Splitter', mini: 'Shard', dart: 'Dodger', gunner: 'Gunner', well: 'Singularity' },
    fr: { drifter: 'Rôdeur', seeker: 'Traqueur', splitter: 'Diviseur', mini: 'Éclat', dart: 'Esquiveur', gunner: 'Artilleur', well: 'Singularité' },
  };
  for (const k of kinds) {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = c.height = 112;
    const g = c.getContext('2d')!;
    const e = new Enemy(k);
    e.radius = e.def.radius;
    e.age = 0.6;
    g.translate(56, 56);
    g.scale(1.6, 1.6);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = g.lineJoin = 'round';
    drawEnemy(g, e, 0);
    const cap = document.createElement('figcaption');
    cap.textContent = names[settings.lang][k];
    fig.append(c, cap);
    host.append(fig);
  }
}

// ───────────────────────────── screens & state ─────────────────────────────

function show(s: Screen): void {
  screen = s;
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== s;
  });
  const first = s ? document.querySelector<HTMLButtonElement>(`[data-screen="${s}"] .btn`) : null;
  if (first && input.state.device !== 'touch') first.focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
  document.body.classList.toggle('playing', state === 'playing');
  $('#touch-buttons').hidden = !(state === 'playing' && input.state.device === 'touch');
}

function startGame(): void {
  audio.unlock();
  audio.musicOn = true;
  world.reset(false);
  state = 'playing';
  show(null);
}

function pause(): void {
  if (state !== 'playing') return;
  state = 'paused';
  audio.musicOn = false;
  show('pause');
}

function resume(): void {
  if (state !== 'paused') return;
  state = 'playing';
  audio.musicOn = true;
  show(null);
}

function toTitle(): void {
  state = 'title';
  world.reset(true);
  audio.musicOn = true;
  show('title');
}

function onGameOver(s: RunStats): void {
  if (world.attract) return;
  state = 'over';
  overAt = performance.now();
  const record = s.score > best;
  if (record) {
    best = s.score;
    save('best', best);
  }
  $('#new-record').hidden = !record;
  $('#final-score').textContent = s.score.toLocaleString();
  const mm = Math.floor(s.time / 60);
  const ss = Math.floor(s.time % 60).toString().padStart(2, '0');
  const rows: [I18nKey, string][] = [
    ['waveReached', String(s.wave)],
    ['kills', s.kills.toLocaleString()],
    ['maxMult', `×${s.maxMult}`],
    ['time', `${mm}:${ss}`],
  ];
  $('#stats').innerHTML = rows.map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`).join('');
  $('#best-score').textContent = best.toLocaleString();
  show('over');
}

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.unlock();
    audio.play('select');
    switch (b.dataset.action) {
      case 'play':
      case 'restart':
        startGame();
        break;
      case 'resume':
        resume();
        break;
      case 'quit':
        toTitle();
        break;
      case 'howto':
        returnScreen = screen;
        show('howto');
        break;
      case 'settings':
        returnScreen = screen;
        show('settings');
        break;
      case 'back':
        show(returnScreen);
        break;
    }
  }),
);

document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach((b) =>
  b.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.pressTouchButton(b.dataset.touch as 'bomb' | 'dash' | 'pause');
  }),
);

input.onGesture = () => {
  audio.unlock();
  if (!audio.musicOn && state !== 'paused') audio.musicOn = true;
};

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio.suspend();
  } else audio.resume();
});

// ───────────────────────────── main loop ─────────────────────────────

function playerControls(): Controls {
  const s = input.state;
  let aim: number;
  if (s.device === 'keyboard') {
    const m = renderer.screenToWorld(s.mouseX, s.mouseY);
    aim = Math.atan2(m.y - world.py, m.x - world.px);
  } else {
    aim = Math.atan2(s.aimY, s.aimX);
  }
  return { moveX: s.moveX, moveY: s.moveY, aim, firing: s.firing, bomb: s.bomb, dash: s.dash };
}

const idle: Controls = { moveX: 0, moveY: 0, aim: 0, firing: false, bomb: false, dash: false };

const loop = new GameLoop({
  update(dt) {
    input.poll();
    const s = input.state;
    switch (state) {
      case 'title':
        world.update(dt, world.aiControls());
        // Gamepad: any face button on the title starts a run.
        if (s.device === 'gamepad' && (s.dash || s.bomb || s.pause) && screen === 'title') startGame();
        break;
      case 'playing':
        if (s.pause) {
          pause();
          break;
        }
        world.update(dt, playerControls());
        if (input.state.device === 'touch') $('#touch-buttons').hidden = false;
        break;
      case 'paused':
        if (s.pause && screen === 'pause') resume();
        break;
      case 'over':
        world.update(dt, idle);
        if (s.device === 'gamepad' && (s.dash || s.bomb) && performance.now() - overAt > 800) startGame();
        break;
    }
  },
  render() {
    world.render(renderer);
    renderer.present();
    drawHud(renderer.ctx, world, input, renderer.width, renderer.height, {
      best,
      showFps: settings.fps,
      fps: loop.fps,
      playing: state === 'playing' || state === 'paused',
    });
  },
});

applySettings();
show('title');
loop.start();

// Expose for debugging / automated playtests.
(window as unknown as { __neonVoid: unknown }).__neonVoid = { world, renderer, startGame };
