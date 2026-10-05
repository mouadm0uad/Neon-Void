/**
 * Procedural audio engine — no sample files.
 *
 *  sfx ──► panner ──┐                       ┌──► reverb (convolver) ─┐
 *                   ├──► sfx bus ───────────┤                        │
 *  ui  ─────────────┘                       └────────────────────────┼──► master ─► limiter ─► out
 *  music ─► pump (sidechain) ─► duck ─► muffle LPF ─► music bus ─────┘
 *                └─ echo (tempo-synced delay) ┘
 *
 * Every effect is layered from oscillators, FM pairs and filtered noise; sounds
 * are panned by on-screen position, big hits duck the music, and pausing or
 * shopping muffles the mix through a lowpass. Works with OfflineAudioContext
 * too, which is how the test harness renders and measures every sound.
 */
import { Music, type Song } from './music';
import { Synth, midi } from './synth';

export type Sfx =
  | 'shoot'
  | 'hit'
  | 'explode'
  | 'bigExplode'
  | 'pickup'
  | 'powerup'
  | 'bomb'
  | 'dash'
  | 'spawn'
  | 'playerHit'
  | 'enemyShoot'
  | 'wave'
  | 'waveClear'
  | 'select'
  | 'move'
  | 'buy'
  | 'deny'
  | 'shieldBreak'
  | 'shieldUp'
  | 'drone'
  | 'bossPhase'
  | 'bossCharge'
  | 'bossDeath'
  | 'gameOver'
  | 'extraLife'
  | 'heartbeat'
  | 'wellGulp';

export const ALL_SFX: readonly Sfx[] = [
  'shoot',
  'hit',
  'explode',
  'bigExplode',
  'pickup',
  'powerup',
  'bomb',
  'dash',
  'spawn',
  'playerHit',
  'enemyShoot',
  'wave',
  'waveClear',
  'select',
  'move',
  'buy',
  'deny',
  'shieldBreak',
  'shieldUp',
  'drone',
  'bossPhase',
  'bossCharge',
  'bossDeath',
  'gameOver',
  'extraLife',
  'heartbeat',
  'wellGulp',
];

export interface PlayOpts {
  pitch?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
  vol?: number;
}

/** Minimum seconds between repeats, so a 40-enemy chain doesn't clip. */
const MIN_GAP: Partial<Record<Sfx, number>> = {
  shoot: 0.055,
  hit: 0.03,
  explode: 0.03,
  enemyShoot: 0.07,
  pickup: 0.025,
  spawn: 0.08,
  drone: 0.06,
  move: 0.04,
  wellGulp: 0.08,
};

// Minor pentatonic: shard pickups climb this scale, so chains play melodies.
const PENTA = [0, 3, 5, 7, 10];

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private synth!: Synth;
  private music!: Music;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicBus!: GainNode;
  private duckNode!: GainNode;
  private muffleLP!: BiquadFilterNode;
  private sfxLP!: BiquadFilterNode;
  private echo!: DelayNode;
  private reverbIn!: GainNode;
  private schedulerId = 0;
  private nextNoteTime = 0;
  private lastPlayed = new Map<Sfx, number>();
  private pickupStep = 0;
  private lastPickup = -1;

  private _sfxVol = 0.8;
  private _musicVol = 0.55;
  private _muted = false;
  private _intensity = 0;
  private _song: Song = 'none';

  get ready(): boolean {
    return this.ctx !== null;
  }
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.init(new Ctor({ latencyHint: 'interactive' }));
    this.nextNoteTime = this.ctx!.currentTime + 0.08;
    this.schedulerId = window.setInterval(() => this.schedule(), 25);
  }

  /** Build the graph on any context (real-time or offline). */
  init(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    const s = (this.synth = new Synth(ctx));

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.85;
    this.master.connect(limiter);

    // Shared room reverb.
    const conv = ctx.createConvolver();
    conv.buffer = s.impulse(2.4, 3.2);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.32;
    this.reverbIn.connect(conv).connect(revOut).connect(this.master);

    // SFX bus (with its own muffle filter for pause/shop).
    this.sfxLP = ctx.createBiquadFilter();
    this.sfxLP.type = 'lowpass';
    this.sfxLP.frequency.value = 20000;
    this.sfxLP.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this._sfxVol;
    this.sfxBus.connect(this.sfxLP);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.22;
    this.sfxBus.connect(sfxSend).connect(this.reverbIn);

    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.7;
    this.uiBus.connect(this.master);

    // Music chain.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this._musicVol * 0.8;
    this.musicBus.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.3;
    this.musicBus.connect(musicSend).connect(this.reverbIn);
    this.muffleLP = ctx.createBiquadFilter();
    this.muffleLP.type = 'lowpass';
    this.muffleLP.frequency.value = 20000;
    this.muffleLP.Q.value = 0.8;
    this.muffleLP.connect(this.musicBus);
    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.muffleLP);
    const pump = ctx.createGain();
    pump.connect(this.duckNode);

    // Ping-pong-ish echo for arps / bells (dotted 8th at ~114 BPM).
    this.echo = ctx.createDelay(1.5);
    this.echo.delayTime.value = 0.39;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const fbLP = ctx.createBiquadFilter();
    fbLP.type = 'lowpass';
    fbLP.frequency.value = 3200;
    const echoIn = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    echoIn.connect(pump);
    echoIn.connect(this.echo);
    this.echo.connect(fbLP).connect(fb).connect(this.echo);
    fbLP.connect(wet).connect(pump);

    this.music = new Music(s, { main: pump, echo: echoIn, pump });
    this.music.intensity = this._intensity;
    this.music.setSong(this._song);
  }

  // ───────────────────────────── controls ─────────────────────────────

  set sfxVolume(v: number) {
    this._sfxVol = v;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  set musicVolume(v: number) {
    this._musicVol = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05);
  }
  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.03);
  }
  get intensity(): number {
    return this._intensity;
  }
  set intensity(v: number) {
    this._intensity = v;
    if (this.music) this.music.intensity = v;
  }

  setSong(song: Song): void {
    this._song = song;
    this.music?.setSong(song);
  }

  /** Lowpass the mix (pause menu, upgrade bay). */
  muffle(on: boolean, sfxToo = true): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.muffleLP.frequency.setTargetAtTime(on ? 650 : 20000, t, on ? 0.08 : 0.2);
    this.sfxLP.frequency.setTargetAtTime(on && sfxToo ? 900 : 20000, t, 0.08);
  }

  /** Briefly duck the music under a big hit. */
  duck(depth = 0.5, seconds = 0.6): void {
    if (!this.ctx) return;
    const g = this.duckNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.01);
    g.setTargetAtTime(1, t + seconds * 0.3, seconds * 0.35);
  }

  suspend(): void {
    if (this.ctx instanceof AudioContext) void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx instanceof AudioContext) void this.ctx.resume();
  }

  dispose(): void {
    clearInterval(this.schedulerId);
    if (this.ctx instanceof AudioContext) void this.ctx.close();
  }

  // ───────────────────────────── music clock ─────────────────────────────

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || (ctx instanceof AudioContext && ctx.state !== 'running')) return;
    if (this.nextNoteTime < ctx.currentTime - 0.2) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const sx = this.music.sixteenth;
      this.echo.delayTime.setTargetAtTime(sx * 3, this.nextNoteTime, 0.5);
      this.music.tick(this.nextNoteTime);
      this.nextNoteTime += sx;
    }
  }

  /** Offline helper: schedule `seconds` of music from t=0. */
  scheduleOffline(seconds: number): void {
    let t = 0.05;
    while (t < seconds) {
      this.music.tick(t);
      t += this.music.sixteenth;
    }
  }

  // ───────────────────────────── SFX ─────────────────────────────

  play(name: Sfx, opts: PlayOpts | number = {}, at?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx instanceof AudioContext && ctx.state !== 'running') return;
    const o: PlayOpts = typeof opts === 'number' ? { pitch: opts } : opts;
    const t = at ?? ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0;
    if (at === undefined && gap > 0) {
      const last = this.lastPlayed.get(name) ?? -1;
      if (t - last < gap) return;
    }
    this.lastPlayed.set(name, t);
    const p = o.pitch ?? 1;
    const pan = o.pan ?? 0;
    const v = o.vol ?? 1;
    const s = this.synth;
    const out = this.sfxBus;
    const ui = this.uiBus;
    const r = (k = 0.06) => 1 + (Math.random() - 0.5) * k;

    switch (name) {
      case 'shoot': {
        const f = 1250 * p * r();
        s.tone(t, f, 0.06, out, { type: 'square', to: f * 0.3, vol: 0.045 * v, pan, filter: [5000, 1200] });
        s.noiseBurst(t, 0.025, out, { type: 'highpass', from: 6000, vol: 0.025 * v, pan });
        break;
      }
      case 'drone':
        s.tone(t, 2100 * r(), 0.04, out, { type: 'triangle', to: 900, vol: 0.03 * v, pan });
        break;
      case 'enemyShoot':
        s.tone(t, 620 * r(), 0.16, out, { type: 'sawtooth', to: 180, vol: 0.05 * v, pan, filter: [3000, 500, 4] });
        s.tone(t, 310, 0.12, out, { type: 'square', to: 120, vol: 0.02 * v, pan });
        break;
      case 'hit':
        s.fm(t, 900 * p * r(0.2), 0.07, out, 3.7, 2, 0.05 * v, pan);
        s.noiseBurst(t, 0.03, out, { type: 'bandpass', from: 3500, q: 3, vol: 0.05 * v, pan });
        break;
      case 'explode': {
        // Thump + crackle + filtered blast; pitch follows enemy size.
        s.tone(t, 150 * p, 0.28, out, { to: 38, vol: 0.28 * v, pan });
        s.noiseBurst(t, 0.38 * (1.2 - p * 0.2), out, { from: 3200 * p, to: 180, vol: 0.24 * v, pan });
        s.noiseBurst(t + 0.02, 0.12, out, { type: 'highpass', from: 5000, to: 2500, vol: 0.08 * v, pan });
        s.fm(t, 220 * p, 0.2, out, 1.41, 4, 0.06 * v, pan);
        break;
      }
      case 'bigExplode':
      case 'bossDeath': {
        const big = name === 'bossDeath';
        s.tone(t, 110, big ? 2.4 : 1.3, out, { to: 22, vol: 0.55 * v, pan });
        s.noiseBurst(t, big ? 2.8 : 1.5, out, { from: 2600, to: 70, vol: 0.5 * v, pan });
        s.saws(t, 82, big ? 1.6 : 0.9, this.synth.out(out, pan), 0.12 * v, [1800, 60], [-25, 0, 25], true);
        s.noiseBurst(t, 0.25, out, { type: 'highpass', from: 7000, to: 2000, vol: 0.12 * v, pan });
        if (big) {
          [0, 7, 12, 19, 24].forEach((iv, i) => s.fm(t + 0.35 + i * 0.09, midi(57 + iv), 1.6, out, 2, 1.2, 0.06, (i - 2) * 0.3));
        }
        this.duck(big ? 0.85 : 0.55, big ? 2 : 0.8);
        break;
      }
      case 'bomb': {
        s.noiseBurst(t, 0.22, out, { type: 'bandpass', from: 400, to: 6000, q: 1.5, vol: 0.25, reverse: true });
        s.tone(t + 0.2, 70, 1.8, out, { to: 18, vol: 0.6 });
        s.noiseBurst(t + 0.2, 2.0, out, { from: 7000, to: 50, vol: 0.5 });
        s.tone(t + 0.2, 1400, 0.9, out, { type: 'square', to: 40, vol: 0.06, filter: [6000, 200] });
        s.saws(t + 0.2, 55, 1.4, out, 0.1, [1200, 40], [-30, 0, 30], true);
        this.duck(0.9, 1.4);
        break;
      }
      case 'dash':
        s.noiseBurst(t, 0.22, out, { type: 'bandpass', from: 800, to: 7000, q: 2.5, vol: 0.2 * v, pan });
        s.tone(t, 320, 0.15, out, { to: 1300, vol: 0.06 * v, pan, type: 'triangle' });
        break;
      case 'spawn':
        s.tone(t, 180 * r(0.3), 0.32, out, { to: 760, vol: 0.035 * v, pan, attack: 0.12, vibrato: [40, 18] });
        break;
      case 'wellGulp':
        s.tone(t, 420, 0.25, out, { to: 60, vol: 0.12 * v, pan, type: 'triangle' });
        s.noiseBurst(t, 0.2, out, { from: 900, to: 120, q: 6, vol: 0.08 * v, pan });
        break;
      case 'pickup': {
        // Consecutive pickups climb a pentatonic scale → little melodies.
        if (t - this.lastPickup > 0.6) this.pickupStep = 0;
        this.lastPickup = t;
        const step = Math.min(this.pickupStep++, 14);
        const n = 69 + PENTA[step % 5]! + 12 * Math.floor(step / 5);
        s.fm(t, midi(n), 0.16, out, 2, 0.8, 0.05 * v, pan);
        s.tone(t, midi(n + 12), 0.08, out, { vol: 0.02 * v, pan });
        break;
      }
      case 'powerup':
        [0, 4, 7, 12, 16].forEach((iv, i) => {
          s.tone(t + i * 0.055, midi(72 + iv), 0.22, out, { type: 'square', vol: 0.045, filter: [6000, 1500], pan: (i - 2) * 0.25 });
          s.fm(t + i * 0.055, midi(84 + iv), 0.3, out, 3, 0.6, 0.025);
        });
        break;
      case 'extraLife':
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((iv, i) =>
          s.tone(t + i * 0.07, midi(72 + iv), 0.25, out, { type: 'square', vol: 0.05, filter: [5000, 1500] }),
        );
        break;
      case 'shieldUp':
        s.tone(t, 400, 0.5, out, { to: 1600, vol: 0.06, type: 'triangle', vibrato: [30, 12], attack: 0.1 });
        s.fm(t + 0.25, 1568, 0.6, out, 2.5, 1, 0.04);
        break;
      case 'shieldBreak':
        // Glass: inharmonic FM partials + bright noise.
        [2093, 2637, 3322, 4186].forEach((f, i) => s.fm(t + i * 0.012, f * r(0.1), 0.6, out, 1.73, 2.5, 0.05, (i - 1.5) * 0.4));
        s.noiseBurst(t, 0.45, out, { type: 'highpass', from: 5000, to: 9000, vol: 0.18 });
        s.tone(t, 300, 0.4, out, { to: 60, vol: 0.2 });
        this.duck(0.5, 0.5);
        break;
      case 'playerHit':
        s.noiseBurst(t, 1.1, out, { from: 3800, to: 80, vol: 0.5 });
        s.saws(t, 220, 0.9, out, 0.15, [3000, 80], [-40, 0, 40], true);
        s.tone(t, 880, 0.6, out, { type: 'square', to: 110, vol: 0.06, filter: [4000, 300] });
        s.tone(t, 90, 1.1, out, { to: 25, vol: 0.5 });
        this.duck(0.9, 1.6);
        break;
      case 'heartbeat':
        s.tone(t, 70, 0.18, out, { to: 40, vol: 0.32 });
        s.tone(t + 0.2, 62, 0.22, out, { to: 36, vol: 0.24 });
        break;
      case 'bossCharge':
        s.tone(t, 180, 0.95, out, { type: 'sawtooth', to: 1400, vol: 0.06, filter: [800, 5000, 6], pan, vibrato: [60, 14] });
        s.noiseBurst(t, 0.95, out, { type: 'bandpass', from: 500, to: 5000, q: 3, vol: 0.1, reverse: true, pan });
        break;
      case 'bossPhase':
        s.saws(t, 55, 1.4, out, 0.14, [400, 2400], [-20, 0, 20], true, 0.2);
        [0, 1].forEach((i) => s.tone(t + i * 0.35, 880, 0.3, out, { type: 'square', to: 660, vol: 0.05, filter: [3000, 1000] }));
        s.noiseBurst(t, 1, out, { from: 3000, to: 100, vol: 0.3 });
        this.duck(0.6, 1);
        break;
      case 'wave':
        [0, 7, 12, 19].forEach((iv, i) => s.fm(t + i * 0.08, midi(64 + iv), 0.7, out, 2, 1, 0.06, (i - 1.5) * 0.4));
        s.noiseBurst(t, 0.5, out, { type: 'bandpass', from: 300, to: 4000, q: 2, vol: 0.06, reverse: true });
        break;
      case 'waveClear':
        [
          [0, 4, 7],
          [5, 9, 12],
          [7, 11, 14, 19],
        ].forEach((ch, i) =>
          ch.forEach((iv) =>
            s.tone(t + i * 0.12, midi(67 + iv), i === 2 ? 0.9 : 0.16, out, { type: 'square', vol: 0.03, filter: [5000, 1200] }),
          ),
        );
        break;
      case 'gameOver':
        [12, 7, 3, 0, -5].forEach((iv, i) => s.saws(t + i * 0.22, midi(57 + iv), 0.6 + i * 0.1, out, 0.05, [2400, 300], [-10, 10]));
        s.tone(t, midi(33), 3, out, { vol: 0.2, attack: 0.3, hold: 0.4 });
        break;
      case 'select':
        s.tone(t, 880, 0.07, ui, { type: 'square', to: 1320, vol: 0.05, filter: [6000, 2000] });
        break;
      case 'move':
        s.tone(t, 1760, 0.025, ui, { type: 'triangle', vol: 0.03 });
        break;
      case 'buy':
        s.fm(t, midi(83), 0.12, ui, 2, 0.6, 0.08);
        s.fm(t + 0.07, midi(88), 0.5, ui, 2, 0.6, 0.08);
        break;
      case 'deny':
        s.tone(t, 140, 0.18, ui, { type: 'square', vol: 0.06, filter: [900, 300] });
        s.tone(t + 0.1, 110, 0.2, ui, { type: 'square', vol: 0.06, filter: [900, 300] });
        break;
    }
  }
}
