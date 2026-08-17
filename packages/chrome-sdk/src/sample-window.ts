// Accumulating a run of durations and reporting them on an interval.
//
// The frame path crosses a process boundary and several stages, and telling
// which stage is slow needs each one accumulated separately and reported
// together. This is the shape they all use.

/** What one reporting window saw. */
export type SampleReport = {
  count: number;
  averageMs: number;
  worstMs: number;
};

/** Durations recorded since the last report. */
export class SampleWindow {
  #count = 0;
  #total = 0;
  #worst = 0;

  record(ms: number): void {
    this.#count += 1;
    this.#total += ms;
    this.#worst = Math.max(this.#worst, ms);
  }

  /**
   * Take what was recorded and start a fresh window.
   *
   * `undefined` when nothing was recorded: a window with nothing in it has
   * nothing to say, and an untouched desktop should not fill the log.
   */
  take(): SampleReport | undefined {
    if (this.#count === 0) {
      return undefined;
    }
    const report = {
      averageMs: this.#total / this.#count,
      count: this.#count,
      worstMs: this.#worst,
    };
    this.#count = 0;
    this.#total = 0;
    this.#worst = 0;
    return report;
  }
}
