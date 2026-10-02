/**
 * Adaptive soundtrack. Four procedurally-voiced songs share one step sequencer:
 *
 *   title  dreamy Am7–Fmaj7–Cmaj7–Em7, FM bells through a tape delay
 *   game   driving synthwave; layers (hats, claps, arp, lead, fills) enter
 *          as `intensity` rises, kick sidechain-pumps the whole mix
 *   boss   138 BPM D minor, distorted rolling bass, saw stabs, tom fills
 *   shop   lo-fi swing, FM electric piano, muffled drums
 *
 * Song changes are quantised to the next bar line so transitions stay musical.
 */
import { Synth, midi } from './synth';

export type Song = 'none' | 'title' | 'game' | 'boss' | 'shop';

export interface MusicBuses {
  /** Dry music input (post-pump). */
  main: AudioNode;
  /** Tempo-synced delay send for arps and bells. */
  echo: AudioNode;
  /** Sidechain gain the kick ducks. */
  pump: GainNode;
}

interface SongDef {
  bpm: (lvl: number) => number;
  swing: number;
  chords: number[][];
}

const SONGS: Record<Exclude<Song, 'none'>, SongDef> = {
  title: {
    bpm: () => 92,
    swing: 0,
    chords: [
      [45, 57, 60, 64, 67],
      [41, 57, 60, 64, 65],
      [48, 55, 59, 60, 64],
      [40, 55, 59, 62, 64],
    ],
  },
  game: {
    bpm: (l) => 114 + Math.round(l * 12),
    swing: 0,
    chords: [
      [45, 57, 60, 64],
      [41, 57, 60, 65],
      [48, 55, 60, 64],
      [43, 55, 59, 62],
      [45, 57, 60, 64],
      [41, 57, 60, 65],
      [43, 55, 59, 62],
      [40, 56, 59, 64],
    ],
  },
  boss: {
    bpm: () => 138,
    swing: 0,
    chords: [
      [38, 50, 53, 57],
      [34, 50, 53, 58],
      [43, 50, 55, 58],
      [45, 49, 52, 57],
    ],
  },
  shop: {
    bpm: () => 84,
    swing: 0.16,
    chords: [
      [38, 53, 57, 60, 64],
      [43, 53, 57, 59, 64],
      [36, 52, 55, 59, 62],
      [45, 55, 60, 64, 67],
    ],
  },
};

// Melody rhythms (1 = note) and contour indices into the chord's upper tones.
const LEAD_RHYTHM = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];
const LEAD_CONTOUR = [2, 1, 3, 2, 1, 0, 2, 3, 3, 2, 1, 2, 0, 1, 2, 1];
const BOSS_RHYTHM = [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const ARP = [0, 1, 2, 3, 2, 1, 3, 1];

export class Music {
  song: Song = 'none';
  private queued: Song | null = null;
  step = 0;
  intensity = 0;

  constructor(
    private readonly s: Synth,
    private readonly b: MusicBuses,
  ) {}

  setSong(song: Song): void {
    if (song === this.song && this.queued === null) return;
    if (song === this.queued) return;
    if (this.song === 'none' || song === 'none') {
      this.song = song;
      this.queued = null;
      this.step = 0;
    } else this.queued = song;
  }

  /** Seconds per 16th note for the current song. */
  get sixteenth(): number {
    if (this.song === 'none') return 0.125;
    return 60 / SONGS[this.song].bpm(this.intensity) / 4;
  }

  /** Schedule one 16th-note step at absolute time `t`. */
  tick(t: number): void {
    if (this.queued !== null && this.step % 16 === 0) {
      this.song = this.queued;
      this.queued = null;
      this.step = 0;
    }
    const song = this.song;
    if (song === 'none') {
      this.step++;
      return;
    }
    const def = SONGS[song];
    const sx = this.sixteenth;
    const s16 = this.step % 16;
    const bar = Math.floor(this.step / 16) % def.chords.length;
    const chord = def.chords[bar]!;
    const tt = t + (s16 % 2 === 1 ? def.swing * sx : 0);
    switch (song) {
      case 'title':
        this.title(tt, s16, bar, chord, sx);
        break;
      case 'game':
        this.game(tt, s16, bar, chord, sx);
        break;
      case 'boss':
        this.boss(tt, s16, bar, chord, sx);
        break;
      case 'shop':
        this.shop(tt, s16, bar, chord, sx);
        break;
    }
    this.step++;
  }

  // ───────────────────────────── songs ─────────────────────────────

  private title(t: number, s16: number, _bar: number, c: number[], sx: number): void {
    const { s, b } = this;
    if (s16 === 0) {
      this.pad(t, c.slice(1), sx * 16, 0.028, 900);
      s.tone(t, midi(c[0]! - 12), sx * 15, b.main, { vol: 0.16, attack: 0.08, hold: 0.6 });
      this.kick(t, 0.35);
    }
    if (s16 === 10) this.kick(t, 0.22);
    if (s16 % 2 === 0) {
      const tones = c.slice(1);
      const n = tones[ARP[(s16 / 2) % ARP.length]! % tones.length]! + 12;
      s.fm(t, midi(n), sx * 5, b.echo, 3.01, 1.2, 0.05, (s16 / 8 - 1) * 0.5);
    }
    if (s16 % 4 === 2) this.hat(t, 0.012);
  }

  private game(t: number, s16: number, bar: number, c: number[], sx: number): void {
    const { s, b } = this;
    const lvl = this.intensity;
    const root = c[0]!;
    const tones = c.slice(1);

    if (s16 % 4 === 0 || (lvl > 0.75 && s16 === 14)) this.kick(t, 0.55);
    // Octave-jumping synthwave bass.
    if (s16 % 2 === 0) {
      const n = root - 12 + (s16 % 4 === 2 ? 12 : 0);
      s.saws(t, midi(n), sx * 1.8, b.main, 0.11, [260 + lvl * 1800, 120], [0, 7]);
      s.tone(t, midi(n), sx * 1.6, b.main, { vol: 0.09 });
    }
    if (lvl > 0.15 && s16 % 4 === 2) this.hat(t, 0.05);
    if (lvl > 0.55 && s16 % 2 === 1) this.hat(t, 0.025);
    if (lvl > 0.4 && s16 === 14) this.hat(t, 0.04, 0.22);
    if (lvl > 0.3 && (s16 === 4 || s16 === 12)) this.clap(t);
    // Snare fill into the turnaround.
    if (lvl > 0.5 && bar === 7 && s16 >= 12) this.snare(t, 0.08 + (s16 - 12) * 0.04);
    if (lvl > 0.08) {
      const n = tones[ARP[this.step % ARP.length]! % tones.length]! + 12 + (ARP[this.step % ARP.length] === 3 ? 12 : 0);
      s.tone(t, midi(n), sx * 0.9, b.echo, { type: 'square', vol: 0.028 + lvl * 0.02, filter: [1400 + lvl * 3000, 400, 2] });
    }
    if (s16 === 0) this.pad(t, tones, sx * 16, lvl > 0.6 ? 0.018 : 0.03, 1400);
    if (lvl > 0.62 && LEAD_RHYTHM[s16]) {
      const idx = (LEAD_CONTOUR[(s16 + bar * 3) % 16]! + bar) % tones.length;
      const n = tones[idx]! + 24;
      s.saws(t, midi(n), sx * 2.6, b.echo, 0.045, [4200, 1400], [-7, 7]);
    }
  }

  private boss(t: number, s16: number, bar: number, c: number[], sx: number): void {
    const { s, b } = this;
    const root = c[0]!;
    const tones = c.slice(1);
    if (s16 % 4 === 0 || s16 === 10) this.kick(t, 0.65);
    // Rolling, distorted 16th bass.
    const bn = root - 12 + (s16 % 4 === 3 ? 12 : 0);
    s.saws(t, midi(bn), sx * 0.95, b.main, 0.085, [1100, 180], [0, 9], true);
    if (s16 === 4 || s16 === 12) this.snare(t, 0.26);
    this.hat(t, s16 % 2 ? 0.02 : 0.04);
    if ([2, 6, 11, 14].includes(s16)) for (const n of tones) s.saws(t, midi(n), sx * 0.8, b.main, 0.022, [3000, 800], [-10, 10], true);
    if (BOSS_RHYTHM[s16]) {
      const n = tones[(s16 + bar) % tones.length]! + 12 + (s16 === 14 ? 12 : 0);
      s.saws(t, midi(n), sx * 1.6, b.echo, 0.04, [5000, 1800], [-9, 9]);
    }
    // Tom fill on the last bar.
    if (bar === 3 && s16 >= 8 && s16 % 2 === 0) {
      const f = 220 - (s16 - 8) * 18;
      s.tone(t, f, 0.3, b.main, { to: f * 0.5, vol: 0.3 });
    }
    if (s16 === 0) this.pad(t, tones, sx * 16, 0.02, 1800);
  }

  private shop(t: number, s16: number, _bar: number, c: number[], sx: number): void {
    const { s, b } = this;
    const root = c[0]!;
    const tones = c.slice(1);
    if (s16 === 0 || s16 === 7) for (const [i, n] of tones.entries()) s.fm(t + i * 0.012, midi(n), sx * 7, b.echo, 1, 1.6, 0.05, (i - 2) * 0.25);
    if (s16 === 0 || s16 === 10) s.tone(t, midi(root - 12), sx * 5, b.main, { vol: 0.17, attack: 0.01 });
    if (s16 === 0 || s16 === 9) this.kick(t, 0.42);
    if (s16 === 4 || s16 === 12) s.noiseBurst(t, 0.06, b.main, { type: 'bandpass', from: 2400, q: 2, vol: 0.06 });
    if (s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.02 : 0.01);
  }

  // ───────────────────────────── kit ─────────────────────────────

  private kick(t: number, vol: number): void {
    const { s, b } = this;
    s.tone(t, 165, 0.38, b.main, { to: 42, glide: 0.11, vol });
    s.noiseBurst(t, 0.012, b.main, { type: 'highpass', from: 3500, vol: vol * 0.15 });
    // Sidechain pump: duck everything, swell back.
    const g = b.pump.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.45, t);
    g.setTargetAtTime(1, t + 0.015, 0.075);
  }

  private snare(t: number, vol: number): void {
    this.s.noiseBurst(t, 0.17, this.b.main, { type: 'bandpass', from: 1900, to: 1500, q: 0.8, vol });
    this.s.tone(t, 230, 0.09, this.b.main, { type: 'triangle', to: 160, vol: vol * 0.5 });
  }

  private clap(t: number): void {
    for (let i = 0; i < 3; i++) this.s.noiseBurst(t + i * 0.011, 0.09 + i * 0.03, this.b.main, { type: 'bandpass', from: 1300, q: 1.2, vol: 0.13 });
  }

  private hat(t: number, vol: number, dur = 0.035): void {
    this.s.noiseBurst(t, dur, this.b.main, { type: 'highpass', from: 8500, vol });
  }

  private pad(t: number, notes: number[], dur: number, vol: number, cutoff: number): void {
    for (const [i, n] of notes.entries()) {
      this.s.saws(t, midi(n), dur, this.s.out(this.b.main, (i - 1.5) * 0.35), vol, [cutoff, cutoff * 0.5], [-9, 9], false, dur * 0.25);
    }
  }
}
