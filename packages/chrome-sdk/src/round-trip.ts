// How long a keystroke takes to become pixels.
//
// The compositor reports its own half of the frame path, and that half is
// small — a few milliseconds of GPU readback and socket write. What it cannot
// see is the rest of the round trip: the chrome's socket, the hop from there
// into the page, the client's own redraw, and `putImageData`. This measures the
// whole loop from the only place that sees both ends of it — the page that
// sent the keystroke and drew the frame that answered it.
//
// The clock is a parameter of the calls rather than read inside, so the
// arithmetic is tested without one.

import type { SampleReport } from "./sample-window";
import { SampleWindow } from "./sample-window";

export type { SampleReport as RoundTripReport };

/**
 * Round trips completed since the last report, keyed by the app that was
 * typed into.
 */
export class RoundTripWindow {
  /** When the oldest keystroke still waiting for a frame was sent, per app. */
  readonly #waiting = new Map<string, number>();
  readonly #completed = new SampleWindow();

  /** A keystroke went to the host for `appId` at `at`. */
  keyed(appId: string, at: number): void {
    // Only the oldest survives: one frame can answer a whole burst, and the
    // felt lag is how long the *first* character waited. Measuring from the
    // last would report the latency of the fastest one and call the burst fast.
    if (!this.#waiting.has(appId)) {
      this.#waiting.set(appId, at);
    }
  }

  /** A frame for `appId` reached the canvas at `at`. */
  drew(appId: string, at: number): void {
    const sentAt = this.#waiting.get(appId);
    // A frame nobody was waiting on is not a round trip — a terminal redraws
    // its blinking cursor with no input behind it, and counting that would
    // report the blink interval as input latency.
    if (sentAt !== undefined) {
      this.#waiting.delete(appId);
      this.#completed.record(at - sentAt);
    }
  }

  /**
   * Take what was recorded and start a fresh window.
   *
   * Keystrokes still waiting stay waiting — they belong to whichever window
   * their frame lands in.
   */
  take(): SampleReport | undefined {
    return this.#completed.take();
  }
}
