/** Bounded playback history with a shuffled bag: every photo appears once per cycle. */
export class PlaybackOrder {
  private bag: number[] = [];
  private history: number[];
  private cursor = 0;
  constructor(readonly count: number, public random = false, public loop = true, start = 0, private rng = Math.random) {
    this.history = count ? [Math.max(0, Math.min(start, count - 1))] : [];
    this.fillBag(true);
  }
  get current(): number { return this.history[this.cursor] ?? 0; }
  peekNext(): number | null {
    if (!this.count) return null;
    if (this.count === 1) return this.loop ? 0 : null;
    if (!this.random) return this.current + 1 < this.count ? this.current + 1 : this.loop ? 0 : null;
    if (this.cursor + 1 < this.history.length) return this.history[this.cursor + 1];
    if (!this.bag.length) { if (!this.loop) return null; this.fillBag(); }
    return this.bag[this.bag.length - 1] ?? null;
  }
  private fillBag(skipCurrent = false): void {
    this.bag = Array.from({ length: this.count }, (_, i) => i).filter(i => !skipCurrent || i !== this.current);
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
    if (!skipCurrent && this.bag.length > 1 && this.bag[this.bag.length - 1] === this.current) {
      [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]];
    }
  }
  next(direction: 1 | -1 = 1): number | null {
    if (this.count < 1) return null;
    if (this.count === 1) return this.loop ? 0 : null;
    if (!this.random) {
      const next = this.current + direction;
      if (!this.loop && (next < 0 || next >= this.count)) return null;
      const index = (next + this.count) % this.count;
      this.history = [index]; this.cursor = 0; return index;
    }
    if (direction === -1) {
      if (this.cursor > 0) return this.history[--this.cursor];
      return this.current;
    }
    if (this.cursor + 1 < this.history.length) return this.history[++this.cursor];
    if (!this.bag.length) { if (!this.loop) return null; this.fillBag(); }
    const index = this.bag.pop()!;
    this.history.push(index); this.cursor++;
    if (this.history.length > Math.max(20, this.count * 2)) { this.history.shift(); this.cursor--; }
    return index;
  }
}
