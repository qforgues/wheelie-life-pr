/**
 * Fixed-timestep loop with an accumulator.
 *
 * The physics runs at a locked 120 Hz regardless of display refresh, because a
 * variable step changes how the bike feels - and "how it feels" is the entire
 * product. Rendering runs as fast as the display allows.
 */
export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly fixedStep: number,
    private readonly onFixed: (dt: number) => void,
    private readonly onRender: (dt: number, alpha: number) => void,
    private readonly maxSubSteps = 8,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      // Cap the frame delta so a background tab doesn't fire off a thousand
      // physics steps the moment it comes back.
      const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
      this.lastTime = now;

      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
        this.onFixed(this.fixedStep);
        this.accumulator -= this.fixedStep;
        steps++;
      }
      if (steps === this.maxSubSteps) this.accumulator = 0;

      this.onRender(frameDt, this.accumulator / this.fixedStep);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
