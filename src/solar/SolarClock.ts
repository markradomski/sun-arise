export interface SolarClockState {
  date: Date;
  playing: boolean;
  speedMinutesPerSecond: number;
}

export class SolarClock {
  private state: SolarClockState;
  private listeners = new Set<(state: SolarClockState) => void>();
  private raf = 0;
  private last = performance.now();

  constructor(initialDate: Date) {
    this.state = {
      date: new Date(initialDate),
      playing: false,
      speedMinutesPerSecond: 12,
    };
    this.tick = this.tick.bind(this);
  }

  subscribe(listener: (state: SolarClockState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  setDate(date: Date) {
    this.state = { ...this.state, date: new Date(date) };
    this.emit();
  }

  setTimeMinutes(minutes: number) {
    const d = new Date(this.state.date);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    this.setDate(d);
  }

  setSpeed(speedMinutesPerSecond: number) {
    this.state = { ...this.state, speedMinutesPerSecond: speedMinutesPerSecond };
    this.emit();
  }

  play() {
    if (this.state.playing) return;
    this.state = { ...this.state, playing: true };
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause() {
    this.state = { ...this.state, playing: false };
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() {
    this.state.playing ? this.pause() : this.play();
  }

  private tick(now: number) {
    if (!this.state.playing) return;
    const dt = Math.min(now - this.last, 100);
    this.last = now;

    const d = new Date(this.state.date.getTime() + dt * 60_000 * this.state.speedMinutesPerSecond / 1000);
    this.state = { ...this.state, date: d };
    this.emit();

    this.raf = requestAnimationFrame(this.tick);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }
}