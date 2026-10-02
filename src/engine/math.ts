/** Minimal, allocation-conscious 2D math helpers. */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);

export const len = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const dist = (a: Vec2, b: Vec2): number => Math.sqrt(dist2(a, b));

/** Normalises (x, y) into `out`. Zero vectors stay zero. */
export const normalize = (out: Vec2, x: number, y: number): Vec2 => {
  const l = Math.sqrt(x * x + y * y);
  if (l > 1e-9) {
    out.x = x / l;
    out.y = y / l;
  } else {
    out.x = 0;
    out.y = 0;
  }
  return out;
};

/** Shortest signed difference between two angles, in (-PI, PI]. */
export const angleDiff = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

/** Rotate an angle toward a target by at most `maxStep` radians. */
export const rotateToward = (from: number, to: number, maxStep: number): number => {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
};

export const circlesOverlap = (
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean => {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
