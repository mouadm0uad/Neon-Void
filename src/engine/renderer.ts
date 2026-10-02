/**
 * Canvas2D renderer with a two-octave bloom post-process.
 *
 *   scene (full res, additive)  ──►  display
 *        │ downsample + blur
 *        ├─► bloom A (1/4 res) ──► additive composite (tight glow)
 *        └─► bloom B (1/8 res) ──► additive composite (wide halo)
 *
 * Blur uses `ctx.filter` when the browser supports it; otherwise it falls back
 * to bilinear down/up-sampling, which still gives a soft glow.
 */
import { clamp } from './math';

export type BloomQuality = 'off' | 'low' | 'high';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  /** Screen-shake trauma, 0..1. Shake = trauma² so small hits stay subtle. */
  trauma: number;
  shakeX: number;
  shakeY: number;
  shakeRot: number;
}

function detectFilterSupport(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 9;
    const g = c.getContext('2d');
    if (!g || !('filter' in g)) return false;
    g.filter = 'blur(2px)';
    g.fillStyle = '#fff';
    g.fillRect(4, 4, 1, 1);
    return g.getImageData(1, 4, 1, 1).data[3]! > 0;
  } catch {
    return false;
  }
}

function make(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d')!;
  return [c, g];
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  /** Scene context: draw world + effects here. */
  readonly g: CanvasRenderingContext2D;
  private scene: HTMLCanvasElement;
  private bloomA: HTMLCanvasElement;
  private bloomAG: CanvasRenderingContext2D;
  private bloomB: HTMLCanvasElement;
  private bloomBG: CanvasRenderingContext2D;
  private vignette: HTMLCanvasElement;
  private readonly filterOk = detectFilterSupport();

  width = 0; // CSS pixels
  height = 0;
  dpr = 1;
  bloom: BloomQuality = 'high';
  bloomStrength = 1;
  /** Full-screen flash, 0..1, decays automatically. */
  flash = 0;
  flashColor = '255,255,255';

  readonly camera: Camera = { x: 0, y: 0, zoom: 1, trauma: 0, shakeX: 0, shakeY: 0, shakeRot: 0 };
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    [this.scene, this.g] = make(1, 1);
    [this.bloomA, this.bloomAG] = make(1, 1);
    [this.bloomB, this.bloomBG] = make(1, 1);
    [this.vignette] = make(1, 1);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.bloom === 'high' ? 2 : 1.5);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const w = Math.round(this.width * this.dpr);
    const h = Math.round(this.height * this.dpr);
    this.canvas.width = this.scene.width = w;
    this.canvas.height = this.scene.height = h;
    this.bloomA.width = Math.max(1, w >> 2);
    this.bloomA.height = Math.max(1, h >> 2);
    this.bloomB.width = Math.max(1, w >> 3);
    this.bloomB.height = Math.max(1, h >> 3);
    this.vignette.width = w;
    this.vignette.height = h;
    const vg = this.vignette.getContext('2d')!;
    const grad = vg.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.65)');
    vg.fillStyle = grad;
    vg.fillRect(0, 0, w, h);
  }

  addTrauma(amount: number): void {
    this.camera.trauma = clamp(this.camera.trauma + amount, 0, 1);
  }

  update(dt: number, shakeScale: number): void {
    this.time += dt;
    const c = this.camera;
    const s = c.trauma * c.trauma * shakeScale;
    // Layered sines ≈ smooth noise; cheaper than Perlin and good enough here.
    const t = this.time * 38;
    c.shakeX = s * 22 * (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7) * 0.5);
    c.shakeY = s * 22 * (Math.sin(t * 1.3 + 4.1) + Math.sin(t * 2.9 + 0.3) * 0.5);
    c.shakeRot = s * 0.03 * Math.sin(t * 0.9 + 2.2);
    c.trauma = Math.max(0, c.trauma - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  /** Viewport scale so the visible play area is roughly 1280×800 world units. */
  get worldScale(): number {
    let s = Math.min(this.width / 1280, this.height / 800);
    // Portrait phones: zoom in so the ship isn't microscopic.
    if (this.height > this.width) s = Math.max(s, this.width / 640, this.height / 1300);
    return s * this.camera.zoom;
  }

  /** Visible world-space half extents. */
  get viewHalf(): { w: number; h: number } {
    const s = this.worldScale;
    return { w: this.width / s / 2, h: this.height / s / 2 };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.worldScale;
    return {
      x: (sx - this.width / 2) / s + this.camera.x,
      y: (sy - this.height / 2) / s + this.camera.y,
    };
  }

  beginWorld(bg: string): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = bg;
    g.fillRect(0, 0, this.scene.width, this.scene.height);
    const c = this.camera;
    const s = this.worldScale * this.dpr;
    g.translate(this.scene.width / 2 + c.shakeX * this.dpr, this.scene.height / 2 + c.shakeY * this.dpr);
    g.rotate(c.shakeRot);
    g.scale(s, s);
    g.translate(-c.x, -c.y);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
  }

  /** Composite scene + bloom + vignette onto the display canvas. */
  present(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.scene, 0, 0);

    if (this.bloom !== 'off') {
      const a = this.bloomAG;
      const b = this.bloomBG;
      a.globalCompositeOperation = 'copy';
      a.filter = this.filterOk ? 'blur(3px)' : 'none';
      a.drawImage(this.scene, 0, 0, this.bloomA.width, this.bloomA.height);
      a.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1.1 * this.bloomStrength;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.bloomA, 0, 0, W, H);

      if (this.bloom === 'high') {
        b.globalCompositeOperation = 'copy';
        b.filter = this.filterOk ? 'blur(4px)' : 'none';
        b.drawImage(this.bloomA, 0, 0, this.bloomB.width, this.bloomB.height);
        b.filter = 'none';
        ctx.globalAlpha = 1.0 * this.bloomStrength;
        ctx.drawImage(this.bloomB, 0, 0, W, H);
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0);

    if (this.flash > 0.001) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Leave the display context in CSS-pixel space for HUD drawing.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
