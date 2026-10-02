/**
 * Unified input: keyboard + mouse, gamepad (standard mapping) and dual virtual
 * touch sticks. Every source is reduced to the same abstract `InputState`, and
 * the last-used device decides how aim is interpreted.
 */
import { len } from './math';

export type Device = 'keyboard' | 'gamepad' | 'touch';

export interface InputState {
  moveX: number;
  moveY: number;
  /** Aim direction (unit vector) when using stick/touch; ignored for mouse. */
  aimX: number;
  aimY: number;
  /** Mouse position in screen pixels. */
  mouseX: number;
  mouseY: number;
  firing: boolean;
  bomb: boolean;
  dash: boolean;
  pause: boolean;
  device: Device;
}

interface TouchStick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

const STICK_RADIUS = 60;
const DEADZONE = 0.18;

export class Input {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    mouseX: 0,
    mouseY: 0,
    firing: false,
    bomb: false,
    dash: false,
    pause: false,
    device: 'keyboard',
  };

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = false;
  private padPrev: boolean[] = [];
  private padPressed = new Set<number>();
  private leftStick: TouchStick | null = null;
  private rightStick: TouchStick | null = null;
  private touchButtons = new Set<string>();
  /** Fired on any user gesture — used to unlock the AudioContext. */
  onGesture: (() => void) | null = null;

  constructor(private readonly el: HTMLElement) {
    if (window.matchMedia?.('(pointer: coarse)').matches) this.state.device = 'touch';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    el.addEventListener('mousemove', (e) => {
      this.state.mouseX = e.clientX;
      this.state.mouseY = e.clientY;
      this.state.device = 'keyboard';
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.pressed.add('MouseRight');
      this.state.device = 'keyboard';
      this.onGesture?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
    this.state.device = 'keyboard';
    this.onGesture?.();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (document.activeElement === document.body || document.activeElement === this.el) {
        e.preventDefault();
      }
    }
  };

  /** True once per key press (edge-triggered). Cleared each `poll()`. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Touch buttons rendered by the HUD (bomb / dash / pause). */
  pressTouchButton(name: 'bomb' | 'dash' | 'pause'): void {
    this.touchButtons.add(name);
    this.state.device = 'touch';
    this.onGesture?.();
  }

  get touchSticks(): { left: TouchStick | null; right: TouchStick | null } {
    return { left: this.leftStick, right: this.rightStick };
  }

  get stickRadius(): number {
    return STICK_RADIUS;
  }

  /** Call once per simulation step; consumes edge-triggered presses. */
  poll(): void {
    const s = this.state;
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k.has('KeyW') || k.has('ArrowUp') || k.has('KeyZ')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
    if (k.has('KeyA') || k.has('ArrowLeft') || k.has('KeyQ')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    const l = len(mx, my);
    if (l > 0) {
      mx /= l;
      my /= l;
    }

    let firing = this.mouseDown || k.has('KeyJ');
    let bomb = this.pressed.has('Space') || this.pressed.has('MouseRight') || this.pressed.has('KeyE');
    let dash = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    let pause = this.pressed.has('Escape') || this.pressed.has('KeyP');

    // Gamepad (standard mapping).
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
    if (pad) {
      this.padPressed.clear();
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.padPressed.add(i);
        this.padPrev[i] = b.pressed;
      });
      const lx = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const rx = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      const anyPad = lx.m > 0 || rx.m > 0 || this.padPressed.size > 0;
      if (anyPad) s.device = 'gamepad';
      if (s.device === 'gamepad') {
        mx = lx.x;
        my = lx.y;
        if (rx.m > 0.35) {
          s.aimX = rx.x / rx.m;
          s.aimY = rx.y / rx.m;
          firing = true;
        }
        if ((pad.buttons[7]?.value ?? 0) > 0.5) firing = true;
      }
      if (this.padPressed.has(5) || this.padPressed.has(1)) bomb = true; // RB / B
      if (this.padPressed.has(4) || this.padPressed.has(0) || this.padPressed.has(6)) dash = true; // LB / A / LT
      if (this.padPressed.has(9)) pause = true; // Start
    }

    // Touch sticks.
    if (this.leftStick || this.rightStick) s.device = 'touch';
    if (s.device === 'touch') {
      if (this.leftStick) {
        const v = stickVector(this.leftStick);
        mx = v.x;
        my = v.y;
      }
      if (this.rightStick) {
        const v = stickVector(this.rightStick);
        if (v.m > 0.25) {
          s.aimX = v.x / v.m;
          s.aimY = v.y / v.m;
          firing = true;
        }
      }
    }
    if (this.touchButtons.has('bomb')) bomb = true;
    if (this.touchButtons.has('dash')) dash = true;
    if (this.touchButtons.has('pause')) pause = true;

    s.moveX = mx;
    s.moveY = my;
    s.firing = firing;
    s.bomb = bomb;
    s.dash = dash;
    s.pause = pause;

    this.pressed.clear();
    this.touchButtons.clear();
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.onGesture?.();
    this.state.device = 'touch';
    const half = window.innerWidth / 2;
    for (const t of Array.from(e.changedTouches)) {
      const stick: TouchStick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      if (t.clientX < half && !this.leftStick) this.leftStick = stick;
      else if (t.clientX >= half && !this.rightStick) this.rightStick = stick;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      for (const s of [this.leftStick, this.rightStick]) {
        if (s && s.id === t.identifier) {
          s.x = t.clientX;
          s.y = t.clientY;
          // Floating stick: drag the origin along if the finger moves too far.
          const dx = s.x - s.ox;
          const dy = s.y - s.oy;
          const d = len(dx, dy);
          if (d > STICK_RADIUS * 1.4) {
            const k = (d - STICK_RADIUS * 1.4) / d;
            s.ox += dx * k;
            s.oy += dy * k;
          }
        }
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.leftStick?.id === t.identifier) this.leftStick = null;
      if (this.rightStick?.id === t.identifier) this.rightStick = null;
    }
  };
}

function deadzone(x: number, y: number): { x: number; y: number; m: number } {
  const m = len(x, y);
  if (m < DEADZONE) return { x: 0, y: 0, m: 0 };
  const scaled = Math.min(1, (m - DEADZONE) / (1 - DEADZONE));
  return { x: (x / m) * scaled, y: (y / m) * scaled, m: scaled };
}

function stickVector(s: TouchStick): { x: number; y: number; m: number } {
  const dx = (s.x - s.ox) / STICK_RADIUS;
  const dy = (s.y - s.oy) / STICK_RADIUS;
  const m = Math.min(1, len(dx, dy));
  const l = len(dx, dy) || 1;
  return { x: (dx / l) * m, y: (dy / l) * m, m };
}
