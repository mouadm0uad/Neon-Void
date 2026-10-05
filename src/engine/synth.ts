/**
 * Synthesis primitives shared by sound effects and music. Every function takes
 * an absolute start time so both real-time and offline contexts can schedule
 * sample-accurately. Nodes are fire-and-forget: they disconnect themselves
 * when their sources stop and are garbage-collected.
 */

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export interface ToneOpts {
  type?: OscillatorType;
  /** End frequency for an exponential glide. */
  to?: number;
  /** Glide time (defaults to the whole note). */
  glide?: number;
  attack?: number;
  /** Exponential decay; the note is silent at `dur`. */
  vol?: number;
  detune?: number;
  /** Vibrato depth in cents and rate in Hz. */
  vibrato?: [depth: number, rate: number];
  /** Optional lowpass with envelope: [startHz, endHz, Q]. */
  filter?: [number, number, number?];
  pan?: number;
  /** Hold at full volume for this fraction of `dur` before decaying (pads). */
  hold?: number;
}

export interface NoiseOpts {
  type?: BiquadFilterType;
  from?: number;
  to?: number;
  q?: number;
  vol?: number;
  attack?: number;
  pan?: number;
  /** Fade in instead of decaying (risers). */
  reverse?: boolean;
}

export class Synth {
  readonly noise: AudioBuffer;
  readonly drive: WaveShaperNode['curve'];

  constructor(readonly ctx: BaseAudioContext) {
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2);
    }
    this.drive = curve;
  }

  /** Gain (+ optional stereo panner) into `dest`. Returns the node to connect sources to. */
  out(dest: AudioNode, pan = 0): AudioNode {
    if (pan === 0 || typeof this.ctx.createStereoPanner !== 'function') return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  tone(t: number, freq: number, dur: number, dest: AudioNode, o: ToneOpts = {}): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.vibrato[1];
      lg.gain.value = o.vibrato[0];
      lfo.connect(lg).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    const vol = o.vol ?? 0.2;
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    if (o.hold) g.gain.setValueAtTime(vol, t + Math.max(a, dur * o.hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.filter[0], t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.filter[1]), t + dur);
      f.Q.value = o.filter[2] ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.out(dest, o.pan));
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  noiseBurst(t: number, dur: number, dest: AudioNode, o: NoiseOpts = {}): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.from ?? 4000, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to ?? o.from ?? 4000), t + dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const vol = o.vol ?? 0.2;
    if (o.reverse) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    src.connect(f).connect(g).connect(this.out(dest, o.pan));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.03);
  }

  /** Two-operator FM voice — bells, electric piano, metallic hits. */
  fm(t: number, freq: number, dur: number, dest: AudioNode, ratio: number, index: number, vol: number, pan = 0): void {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, freq * index * 0.05), t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.out(dest, pan));
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.03);
    mod.stop(t + dur + 0.03);
  }

  /** Detuned saw stack through a resonant envelope filter ("supersaw-lite"). */
  saws(
    t: number,
    freq: number,
    dur: number,
    dest: AudioNode,
    vol: number,
    cutoff: [number, number],
    detunes = [-12, 0, 11],
    drive = false,
    attack = 0.005,
  ): void {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff[0], t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff[1]), t + dur);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last: AudioNode = f;
    if (drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.drive;
      f.connect(ws);
      last = ws;
    }
    last.connect(g).connect(dest);
    for (const d of detunes) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.03);
    }
  }

  /** Exponential-decay stereo noise impulse for a ConvolverNode reverb. */
  impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}
