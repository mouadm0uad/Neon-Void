/**
 * Fully procedural audio — no sample files. Sound effects are synthesised with
 * oscillators + filtered noise, and the soundtrack is a small step sequencer
 * scheduled ahead of time on the AudioContext clock (sample-accurate timing).
 * Music intensity layers in as the game heats up.
 */

type Sfx =
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
  | 'select';

const NOTE = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

// A minor-ish progression: Am – F – C – G (MIDI roots).
const PROGRESSION = [45, 41, 48, 43];
const ARP = [0, 7, 12, 15, 12, 7, 3, 7];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private nextNoteTime = 0;
  private step = 0;
  private schedulerId = 0;
  private lastPlayed = new Map<Sfx, number>();
  /** 0..1 — drives which music layers play. */
  intensity = 0;
  musicOn = false;
  private _sfxVol = 0.8;
  private _musicVol = 0.5;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this._sfxVol;
    this.sfxBus.connect(this.master);

    // Music goes through a feedback delay for a spacey synthwave feel.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this._musicVol * 0.55;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.musicBus.connect(this.master);
    this.musicBus.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.schedulerId = window.setInterval(() => this.schedule(), 25);
  }

  set sfxVolume(v: number) {
    this._sfxVol = v;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  set musicVolume(v: number) {
    this._musicVol = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }

  dispose(): void {
    clearInterval(this.schedulerId);
    void this.ctx?.close();
  }

  // ───────────────────────────────── SFX ─────────────────────────────────

  play(name: Sfx, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // Rate-limit spammy sounds so a 40-enemy explosion doesn't clip.
    const minGap: Partial<Record<Sfx, number>> = { shoot: 0.05, hit: 0.03, explode: 0.035, enemyShoot: 0.08, pickup: 0.03, spawn: 0.06 };
    const gap = minGap[name] ?? 0;
    const last = this.lastPlayed.get(name) ?? -1;
    if (t - last < gap) return;
    this.lastPlayed.set(name, t);

    switch (name) {
      case 'shoot':
        this.tone('square', 880 * pitch, 220 * pitch, 0.06, 0.05);
        break;
      case 'enemyShoot':
        this.tone('sawtooth', 330, 160, 0.12, 0.05);
        break;
      case 'hit':
        this.tone('triangle', 520 * pitch, 260 * pitch, 0.05, 0.08);
        break;
      case 'explode':
        this.noiseBurst(0.35, 1800 * pitch, 200, 0.28);
        this.tone('sine', 140 * pitch, 40, 0.25, 0.25);
        break;
      case 'bigExplode':
        this.noiseBurst(1.4, 2600, 80, 0.6);
        this.tone('sine', 90, 25, 1.2, 0.6);
        this.tone('sawtooth', 220, 30, 0.9, 0.15);
        break;
      case 'bomb':
        this.noiseBurst(1.8, 5000, 60, 0.6);
        this.tone('sine', 60, 20, 1.6, 0.7);
        this.tone('square', 1200, 40, 0.8, 0.12);
        break;
      case 'pickup':
        this.tone('sine', 1200 * pitch, 1800 * pitch, 0.06, 0.06);
        break;
      case 'powerup':
        [0, 4, 7, 12].forEach((s, i) => this.tone('square', NOTE(72 + s), NOTE(72 + s), 0.09, 0.08, t + i * 0.06));
        break;
      case 'wave':
        [0, 7, 12, 19].forEach((s, i) => this.tone('triangle', NOTE(64 + s), NOTE(64 + s), 0.25, 0.12, t + i * 0.09));
        break;
      case 'dash':
        this.noiseBurst(0.2, 6000, 800, 0.18, 'highpass');
        this.tone('sine', 300, 900, 0.12, 0.1);
        break;
      case 'spawn':
        this.tone('sine', 200, 600, 0.18, 0.04);
        break;
      case 'playerHit':
        this.noiseBurst(1.0, 3000, 100, 0.5);
        this.tone('sawtooth', 400, 30, 1.0, 0.3);
        break;
      case 'select':
        this.tone('square', 660, 990, 0.05, 0.06);
        break;
    }
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    when?: number,
  ): void {
    const ctx = this.ctx!;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(
    dur: number,
    fStart: number,
    fEnd: number,
    vol: number,
    type: BiquadFilterType = 'lowpass',
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(fStart, t);
    f.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ──────────────────────────────── Music ────────────────────────────────

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const bpm = 112 + this.intensity * 16;
    const sixteenth = 60 / bpm / 4;
    // Keep scheduling bounded if we fell behind (tab throttled).
    if (this.nextNoteTime < ctx.currentTime - 0.2) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      if (this.musicOn) this.playStep(this.step, this.nextNoteTime, sixteenth);
      this.nextNoteTime += sixteenth;
      this.step = (this.step + 1) % 256;
    }
  }

  private playStep(step: number, t: number, dur: number): void {
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const root = PROGRESSION[bar]!;
    const s16 = step % 16;
    const lvl = this.intensity;

    // Kick on quarters, plus offbeat pushes at high intensity.
    if (s16 % 4 === 0 || (lvl > 0.7 && s16 === 14)) this.kick(t);
    // Hats on 8ths, 16ths when intense.
    if (lvl > 0.15 && (s16 % 2 === 1 || (lvl > 0.55 && s16 % 1 === 0))) this.hat(t, s16 % 2 === 1 ? 0.05 : 0.025);
    // Snare/clap on 2 and 4.
    if (lvl > 0.35 && (s16 === 4 || s16 === 12)) this.snare(t);
    // Bass: driving 8ths.
    if (s16 % 2 === 0) this.synth('sawtooth', NOTE(root - 12 + (s16 === 6 || s16 === 14 ? 12 : 0)), t, dur * 1.7, 0.16, 500 + lvl * 900);
    // Arpeggio lead.
    if (lvl > 0.05) {
      const n = root + 24 + ARP[step % ARP.length]!;
      this.synth('square', NOTE(n), t, dur * 0.9, 0.045 + lvl * 0.03, 1400 + lvl * 2800);
    }
    // Pad on bar start.
    if (s16 === 0) {
      for (const iv of [12, 15, 19]) this.synth('triangle', NOTE(root + iv), t, dur * 16, 0.04, 1800);
    }
  }

  private synth(type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), t + dur);
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
  }

  private snare(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }
}
