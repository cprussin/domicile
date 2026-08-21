// How long a keystroke takes to become pixels.
//
// The compositor reports its own half of the frame path, and that half is
// small — a few milliseconds of GPU readback and socket write. What it cannot
// see is the rest of the round trip: the chrome's socket, the hop from there
// into the page, the client's own redraw, and `putImageData`. This measures the
// whole loop from the only place that sees both ends of it — the page that
// sent the keystroke and drew the frame that answered it.
//
// # What a sample is
//
// One key, one frame. A client is only ever asked for the next keystroke once
// the last one has been answered or given up on, so the frame that arrives
// while a key is outstanding is the frame that key caused. Pairing without
// that discipline reads whatever frame happens to arrive next as the answer,
// and a terminal redrawing its blinking cursor then prices the blink interval
// as input latency.
//
// The residual is a blink that lands inside the window a real keystroke is
// being timed in, which no amount of pairing here can tell from an answer —
// only the client could say. `driver_ms` in the harness bounds it: a run whose
// blink rate is high enough to matter shows up as `answered` far below `sent`.
//
// # What is counted
//
// A keystroke that is never answered is *counted*, not dropped. Deleting it
// was the worse of the two failure modes: latency that shows up as a late or
// missing frame then made this report fewer samples rather than worse ones, so
// a regression that swallowed keystrokes made the measurement quieter.
//
// # Why the whole run
//
// Reported cumulatively rather than per interval. A mean over whichever few
// seconds a reader's `tail` happened to catch is not a measurement of
// anything, and the spread between intervals here is wider than any regression
// worth catching — so the last line printed is the answer for the run, and it
// carries the spread that says how much to trust it.
//
// The clock is a parameter of the calls rather than read inside, so the
// arithmetic is tested without one.

/** What the round trips of a run came to. */
export type RoundTripReport = {
  /** Keystrokes sent, whether or not a frame ever answered them. */
  sent: number;
  /** Of those, the ones a frame answered — the population behind the times. */
  answered: number;
  averageMs: number;
  medianMs: number;
  /** The tail that a mean hides, and what a person actually notices. */
  p95Ms: number;
  worstMs: number;
};

/**
 * How long a keystroke may go unanswered before it is counted as unanswered
 * rather than waited for.
 *
 * Generous on purpose: this is not a latency budget, it is the point past
 * which a frame is no longer plausibly the answer to that key. A desktop this
 * slow has a problem the number would not describe anyway.
 */
const GIVE_UP_MS = 2000;

/** Round trips completed over a run, keyed by the app that was typed into. */
export class RoundTripWindow {
  /** When the keystroke still waiting for a frame was sent, per app. */
  readonly #waiting = new Map<string, number>();
  readonly #completed: number[] = [];
  #sent = 0;

  /** A keystroke went to the host for `appId` at `at`. */
  keyed(appId: string, at: number): void {
    this.#expire(appId, at);
    // A key typed while the last one is still outstanding cannot be told apart
    // from it by the frame that follows, so it is counted as sent and no clock
    // starts. The harness paces its keys to make this rare; a person typing
    // fast makes it common, and the count is what says so.
    this.#sent += 1;
    if (!this.#waiting.has(appId)) {
      this.#waiting.set(appId, at);
    }
  }

  /** A frame for `appId` reached the canvas at `at`. */
  drew(appId: string, at: number): void {
    this.#expire(appId, at);
    const sentAt = this.#waiting.get(appId);
    // A frame nobody was waiting on is not a round trip — a terminal redraws
    // its blinking cursor with no input behind it, and counting that would
    // report the blink interval as input latency.
    if (sentAt !== undefined) {
      this.#waiting.delete(appId);
      this.#completed.push(at - sentAt);
    }
  }

  /**
   * What the run has recorded so far, or `undefined` if nothing has been typed
   * — an untouched desktop has nothing to say and should not fill the log.
   *
   * Does not reset: see the note on reporting the whole run.
   */
  report(at: number): RoundTripReport | undefined {
    for (const appId of [...this.#waiting.keys()]) {
      this.#expire(appId, at);
    }
    if (this.#sent === 0) {
      return undefined;
    }
    const sorted = [...this.#completed].sort((left, right) => left - right);
    const total = sorted.reduce((sum, sample) => sum + sample, 0);
    return {
      answered: sorted.length,
      averageMs: sorted.length === 0 ? 0 : total / sorted.length,
      medianMs: at_(sorted, 0.5),
      p95Ms: at_(sorted, 0.95),
      sent: this.#sent,
      worstMs: sorted.at(-1) ?? 0,
    };
  }

  /** Give up on a keystroke old enough that no frame could still answer it. */
  #expire(appId: string, now: number): void {
    const sentAt = this.#waiting.get(appId);
    if (sentAt !== undefined && now - sentAt > GIVE_UP_MS) {
      this.#waiting.delete(appId);
    }
  }
}

/**
 * The sample at `fraction` through `sorted`, by nearest rank.
 *
 * Nearest rank rather than interpolation because these are measurements that
 * happened, and a median between two of them is a number nothing recorded.
 */
const at_ = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
};
