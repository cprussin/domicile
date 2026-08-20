import { afterEach, describe, expect, it } from "bun:test";

import { defaultObservePlacement } from "./observe-placement";

/**
 * A hand-driven animation clock.
 *
 * The module's loop is module state that outlives any one test, so every case
 * has to leave it stopped — `frames.stop()` unfollows everything and turns the
 * clock once, which is what makes the loop notice and give up.
 */
class Frames {
  #pending: (() => void)[] = [];
  #unfollow: (() => void)[] = [];
  #original = globalThis.requestAnimationFrame;
  requested = 0;

  constructor() {
    globalThis.requestAnimationFrame = ((callback: () => void) => {
      this.requested += 1;
      this.#pending.push(callback);
      return this.requested;
      // A cast because the real signature takes a `DOMHighResTimeStamp` this
      // never reads, and the module never reads the handle it returns.
    }) as typeof globalThis.requestAnimationFrame;
  }

  follow(onMoved: () => void): void {
    this.#unfollow.push(defaultObservePlacement(onMoved));
  }

  /** Run every callback the loop has queued, once. */
  turn(): void {
    const due = this.#pending;
    this.#pending = [];
    for (const callback of due) {
      callback();
    }
  }

  stop(): void {
    for (const unfollow of this.#unfollow) {
      unfollow();
    }
    this.turn();
    globalThis.requestAnimationFrame = this.#original;
  }
}

let frames: Frames;

afterEach(() => {
  frames.stop();
});

describe("defaultObservePlacement", () => {
  it("measures every portal on each frame", () => {
    frames = new Frames();
    const seen: string[] = [];
    frames.follow(() => seen.push("term"));
    frames.follow(() => seen.push("editor"));

    frames.turn();
    frames.turn();

    expect(seen).toStrictEqual(["term", "editor", "term", "editor"]);
  });

  it("runs one loop however many portals there are", () => {
    // A timer each would multiply the cost of a layout read per window per
    // frame by nothing gained — they all want the same moment.
    frames = new Frames();
    frames.follow(() => {
      // Only its presence matters here.
    });
    frames.follow(() => {
      // As above.
    });
    const started = frames.requested;

    frames.turn();

    expect(frames.requested - started).toBe(1);
  });

  it("stops the loop when the last portal goes", () => {
    // A desktop with no windows on it should not be reading layout sixty times
    // a second for nothing, and the loop is the only thing keeping itself
    // alive — nothing else would ever cancel it.
    frames = new Frames();
    const unfollow = defaultObservePlacement(() => {
      // Never called: it is unfollowed before the first turn.
    });

    unfollow();
    frames.turn();
    const settled = frames.requested;
    frames.turn();

    expect(frames.requested).toBe(settled);
  });

  it("starts the loop again when a portal comes back", () => {
    // The loop stops itself, so mounting a window after the last one closed
    // has to restart it or that window never moves again.
    frames = new Frames();
    defaultObservePlacement(() => {
      // Unfollowed immediately below.
    })();
    frames.turn();

    let measured = 0;
    frames.follow(() => {
      measured += 1;
    });
    frames.turn();

    expect(measured).toBe(1);
  });

  it("skips a portal unfollowed while the pass was running", () => {
    // Unfollowing is what `disconnectedCallback` does, and a portal that has
    // just been disconnected has no box: measuring it would report a window
    // that is not on the stage. Its turn in this very pass is the one moment
    // it can be asked after it has gone.
    frames = new Frames();
    const seen: string[] = [];
    let unfollowSecond = (): void => {
      // Replaced below, once there is a second portal to unfollow.
    };
    frames.follow(() => {
      seen.push("first");
      unfollowSecond();
    });
    unfollowSecond = defaultObservePlacement(() => {
      seen.push("second");
    });

    frames.turn();

    expect(seen).toStrictEqual(["first"]);
  });

  it("stops the loop on the frame the last portal goes, not the one after", () => {
    // A portal can unfollow itself from inside its own callback — a chrome
    // that unmounts a window in response to what it measured. Deciding whether
    // to carry on before the pass rather than after it would queue a frame
    // whose only work is to notice there is none.
    frames = new Frames();
    let unfollow = (): void => {
      // Replaced below, once there is something to unfollow.
    };
    unfollow = defaultObservePlacement(() => {
      unfollow();
    });
    const booked = frames.requested;

    frames.turn();

    // The pass itself booked nothing further. Deciding before it instead would
    // have booked a frame whose only work is to notice there is none — the
    // count would be one higher here and the loop would stop a frame later.
    expect(frames.requested).toBe(booked);
  });

  it("keeps following every other portal when one of them throws", () => {
    // The loop is shared, so a throw that stopped it would stop the whole
    // desktop following — not just this window, and not just this frame:
    // nothing restarts a loop that never rescheduled itself, so every window
    // mounted afterwards would be stranded too. `new DOMMatrix(…)` throws on a
    // computed value the SDK cannot parse, which has happened before.
    frames = new Frames();
    frames.follow(() => {
      throw new Error("a window the SDK could not measure");
    });
    let measured = 0;
    frames.follow(() => {
      measured += 1;
    });

    // Measured on the same frame as the throw, not merely on the next one:
    // one window the SDK cannot read must not hold up the window behind it in
    // the set, which is what a bare `for` over the followers would do.
    expect(() => {
      frames.turn();
    }).toThrow("a window the SDK could not measure");
    expect(measured).toBe(1);

    // And the loop is still running, so the next frame measures it again.
    expect(() => {
      frames.turn();
    }).toThrow("a window the SDK could not measure");
    expect(measured).toBe(2);
  });

  it("reports every portal that could not be measured, not just the first", () => {
    // Set order is stable, so keeping only the first would hide the second
    // window's failure for the life of the page while reporting the first
    // sixty times a second — one window broken loudly and another broken
    // silently, which is the shape of bug the SDK is built to avoid.
    frames = new Frames();
    frames.follow(() => {
      throw new Error("first");
    });
    frames.follow(() => {
      throw new Error("second");
    });

    let thrown: unknown;
    try {
      frames.turn();
    } catch (failure) {
      thrown = failure;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(
      (thrown as AggregateError).errors.map((error: Error) => error.message),
    ).toStrictEqual(["first", "second"]);
  });

  it("does nothing where the page cannot animate at all", () => {
    // A DOM implementation outside a browsing context lays nothing out, so
    // nothing can move; throwing on the way in would stop every portal being
    // placed rather than stop it being followed.
    frames = new Frames();
    const original = globalThis.requestAnimationFrame;
    // @ts-expect-error -- removing a global the module guards against
    globalThis.requestAnimationFrame = undefined;
    try {
      expect(() => {
        defaultObservePlacement(() => {
          // Never called; there is no clock.
        })();
      }).not.toThrow();
    } finally {
      globalThis.requestAnimationFrame = original;
    }
  });
});
