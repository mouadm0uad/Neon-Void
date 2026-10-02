/**
 * Fixed-timestep game loop ("Fix Your Timestep!"). Simulation runs at a constant
 * rate regardless of display refresh, so physics are deterministic and identical
 * on 60 Hz and 144 Hz monitors. Rendering happens once per animation frame.
 */
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  readonly step: number;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    hz = 120,
    private readonly maxSteps = 8,
  ) {
    this.step = 1 / hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    // Clamp huge gaps (tab switch, breakpoint) to avoid the spiral of death.
    const frameDt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += frameDt;

    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.cb.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;

    this.fpsAcc += frameDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.cb.render(this.acc / this.step, frameDt);
    this.raf = requestAnimationFrame(this.frame);
  };
}
