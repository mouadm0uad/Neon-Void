/** Tiny typed i18n: every key must exist in both languages (enforced by TS + tests). */

export type Lang = 'en' | 'fr';

const en = {
  tagline: 'Twin-stick survival in a warping neon arena',
  play: 'Play',
  resume: 'Resume',
  restart: 'Restart',
  quit: 'Main menu',
  settings: 'Settings',
  howTo: 'How to play',
  back: 'Back',
  paused: 'Paused',
  gameOver: 'Game over',
  newRecord: 'New record!',
  score: 'Score',
  best: 'Best',
  wave: 'Wave',
  waveReached: 'Wave reached',
  kills: 'Kills',
  maxMult: 'Max multiplier',
  time: 'Time',
  language: 'Language',
  sfx: 'Sound effects',
  music: 'Music',
  bloom: 'Bloom',
  shake: 'Screen shake',
  off: 'Off',
  low: 'Low',
  high: 'High',
  on: 'On',
  showFps: 'Show FPS',
  controlsMove: 'Move',
  controlsAim: 'Aim & fire',
  controlsDash: 'Dash (invulnerable)',
  controlsBomb: 'Bomb (clears the screen)',
  controlsPause: 'Pause',
  kbMove: 'WASD / ZQSD / Arrows',
  kbAim: 'Mouse + left click',
  kbDash: 'Shift',
  kbBomb: 'Space / right click',
  kbPause: 'Esc / P',
  padHint: 'Gamepad: left stick move, right stick aim · A/LB dash · B/RB bomb',
  touchHint: 'Touch: left thumb moves, right thumb aims & fires',
  tipShards: 'Collect green shards to raise your multiplier.',
  tipBoss: 'A guardian awakens every 5 waves.',
  waveIncoming: 'Wave {n}',
  bossIncoming: 'Guardian incoming',
  bossName: 'HEXACORE',
  pickupWeapon: 'Weapon up',
  pickupShield: 'Shield',
  pickupBomb: '+1 Bomb',
  pickupRapid: 'Overdrive',
  pickupLife: '+1 Life',
  pickupMagnet: 'Magnet',
  pressToStart: 'Click, tap or press any button',
  lifeLost: 'Ship lost',
  credits: 'Built from scratch in TypeScript — no engine, no assets.',
};

export type I18nKey = keyof typeof en;

const fr: Record<I18nKey, string> = {
  tagline: 'Survie twin-stick dans une arène néon déformable',
  play: 'Jouer',
  resume: 'Reprendre',
  restart: 'Recommencer',
  quit: 'Menu principal',
  settings: 'Paramètres',
  howTo: 'Comment jouer',
  back: 'Retour',
  paused: 'Pause',
  gameOver: 'Partie terminée',
  newRecord: 'Nouveau record !',
  score: 'Score',
  best: 'Record',
  wave: 'Vague',
  waveReached: 'Vague atteinte',
  kills: 'Éliminations',
  maxMult: 'Multiplicateur max',
  time: 'Temps',
  language: 'Langue',
  sfx: 'Effets sonores',
  music: 'Musique',
  bloom: 'Lueur (bloom)',
  shake: "Tremblement d'écran",
  off: 'Non',
  low: 'Bas',
  high: 'Élevé',
  on: 'Oui',
  showFps: 'Afficher les IPS',
  controlsMove: 'Se déplacer',
  controlsAim: 'Viser et tirer',
  controlsDash: 'Esquive (invulnérable)',
  controlsBomb: "Bombe (nettoie l'écran)",
  controlsPause: 'Pause',
  kbMove: 'WASD / ZQSD / Flèches',
  kbAim: 'Souris + clic gauche',
  kbDash: 'Maj',
  kbBomb: 'Espace / clic droit',
  kbPause: 'Échap / P',
  padHint: 'Manette : stick gauche déplace, stick droit vise · A/LB esquive · B/RB bombe',
  touchHint: 'Tactile : pouce gauche déplace, pouce droit vise et tire',
  tipShards: 'Ramassez les éclats verts pour augmenter le multiplicateur.',
  tipBoss: 'Un gardien se réveille toutes les 5 vagues.',
  waveIncoming: 'Vague {n}',
  bossIncoming: 'Gardien en approche',
  bossName: 'HEXACORE',
  pickupWeapon: 'Arme améliorée',
  pickupShield: 'Bouclier',
  pickupBomb: '+1 Bombe',
  pickupRapid: 'Surcharge',
  pickupLife: '+1 Vie',
  pickupMagnet: 'Aimant',
  pressToStart: 'Cliquez, touchez ou appuyez sur un bouton',
  lifeLost: 'Vaisseau perdu',
  credits: 'Codé de zéro en TypeScript — sans moteur ni fichiers externes.',
};

export const dictionaries: Record<Lang, Record<I18nKey, string>> = { en, fr };

let current: Lang = 'en';

export const setLang = (l: Lang): void => {
  current = l;
  document.documentElement.lang = l;
};
export const getLang = (): Lang => current;

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[current][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function detectLang(): Lang {
  const nav = globalThis.navigator?.language?.toLowerCase() ?? 'en';
  return nav.startsWith('fr') ? 'fr' : 'en';
}
