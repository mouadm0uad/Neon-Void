/**
 * Spatial focus navigation for DOM menus, so the whole UI works with a gamepad
 * (D-pad / left stick to move, A to press, B to go back) and arrow keys.
 */
type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), select, input';

export class MenuNav {
  private prev: boolean[] = [];
  private stickLatch = false;
  private repeatT = 0;
  private lastScreen: HTMLElement | null = null;

  constructor(private readonly activeScreen: () => HTMLElement | null) {
    window.addEventListener('keydown', (e) => {
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const d = map[e.code];
      const screen = this.activeScreen();
      if (!d || !screen) return;
      // Let range sliders and selects keep their own arrow behaviour horizontally.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'SELECT' || (el instanceof HTMLInputElement && el.type === 'range')) && (d === 'left' || d === 'right' || el.tagName === 'SELECT')) return;
      e.preventDefault();
      this.move(d);
    });
  }

  /** Call once per frame while a menu is visible. */
  poll(dt: number): void {
    const screen = this.activeScreen();
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad || !screen) return;
    if (screen !== this.lastScreen) {
      // New menu: adopt current button state so a held button doesn't click through.
      this.lastScreen = screen;
      pad.buttons.forEach((b, i) => (this.prev[i] = b.pressed));
      this.stickLatch = true;
      this.repeatT = 0.35;
      return;
    }
    const pressed = (i: number): boolean => {
      const now = !!pad.buttons[i]?.pressed;
      const edge = now && !this.prev[i];
      return edge;
    };
    const edges = {
      a: pressed(0),
      b: pressed(1),
      up: pressed(12),
      down: pressed(13),
      left: pressed(14),
      right: pressed(15),
    };
    pad.buttons.forEach((b, i) => (this.prev[i] = b.pressed));

    // Left stick with latch + auto-repeat.
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const mag = Math.max(Math.abs(x), Math.abs(y));
    let stickDir: Dir | null = null;
    if (mag > 0.6) stickDir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
    if (!stickDir) {
      this.stickLatch = false;
      this.repeatT = 0;
    } else {
      this.repeatT -= dt;
      if (!this.stickLatch || this.repeatT <= 0) {
        this.move(stickDir);
        this.repeatT = this.stickLatch ? 0.14 : 0.35;
        this.stickLatch = true;
      }
    }

    if (edges.up) this.move('up');
    if (edges.down) this.move('down');
    if (edges.left) this.adjustOrMove('left');
    if (edges.right) this.adjustOrMove('right');
    if (edges.a) {
      const el = document.activeElement as HTMLElement | null;
      if (el && screen.contains(el)) {
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          el.checked = !el.checked;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else el.click();
      } else this.focusFirst();
    }
    if (edges.b) screen.querySelector<HTMLButtonElement>('[data-action="back"], [data-action="resume"]')?.click();
  }

  focusFirst(): void {
    this.activeScreen()?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }

  private adjustOrMove(d: 'left' | 'right'): void {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 0.1;
      el.value = String(Number(el.value) + (d === 'right' ? step : -step));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + (d === 'right' ? 1 : n - 1)) % n;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.move(d);
  }

  move(d: Dir): void {
    const screen = this.activeScreen();
    if (!screen) return;
    const items = Array.from(screen.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => e.offsetParent !== null);
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) return items[0]?.focus({ preventScroll: true });
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - ax;
      const dy = r.top + r.height / 2 - ay;
      const main = d === 'left' ? -dx : d === 'right' ? dx : d === 'up' ? -dy : dy;
      const cross = d === 'left' || d === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (main <= 4) continue;
      const score = main + cross * 2.5;
      if (score < bestScore) (bestScore = score), (best = el);
    }
    best?.focus({ preventScroll: false });
  }
}
