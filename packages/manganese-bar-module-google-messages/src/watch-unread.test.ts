import { describe, expect, it } from "bun:test";
import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";

import {
  UNREAD_CONVERSATIONS,
  watchUnread,
  watchUnreadWith,
} from "./watch-unread";

/** A page that answers each count from `answers`, in turn. */
const pageAnswering = (
  ...answers: readonly (() => Promise<number>)[]
): HTMLWebViewElement => {
  const left = [...answers];
  return Object.assign(document.createElement("webview"), {
    countMatches: (selector: string) => {
      expect(selector).toBe(UNREAD_CONVERSATIONS);
      const next = left.shift();
      if (next === undefined) {
        throw new Error("counted more often than the test expected");
      } else {
        return next();
      }
    },
    loading: false,
  });
};

/** A loaded page that counts how often it is asked, and always answers 0. */
const counting = () => {
  const state = { asked: 0 };
  const view = Object.assign(document.createElement("webview"), {
    countMatches: () => {
      state.asked += 1;
      return Promise.resolve(0);
    },
    loading: false,
  });
  return { asked: () => state.asked, view };
};

/** Runs the watch's ticks by hand. */
const byHand = () => {
  const state: { tick: (() => void) | undefined } = { tick: undefined };
  return {
    every: (run: () => void) => {
      state.tick = run;
      return () => {
        state.tick = undefined;
      };
    },
    tick: () => {
      state.tick?.();
    },
  };
};

const counted = (
  view: HTMLWebViewElement,
  every = byHand().every,
  onMissed: (error: unknown) => void = () => undefined,
) =>
  new Promise<number>((resolve) => {
    watchUnread(view, resolve, every, onMissed);
  });

describe("watchUnread", () => {
  it("counts the page's unread conversations once it has loaded", async () => {
    const view = pageAnswering(() => Promise.resolve(2));
    const count = counted(view);

    view.dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));

    expect(await count).toBe(2);
  });

  it("does not count while the page is loading", () => {
    const { asked, view } = counting();
    Object.assign(view, { loading: true });
    watchUnread(view, () => undefined, byHand().every);

    view.dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));

    expect(asked()).toBe(0);
  });

  it("counts again on every tick", async () => {
    const ticks = byHand();
    const view = pageAnswering(
      () => Promise.resolve(2),
      () => Promise.resolve(0),
    );
    const counts: number[] = [];
    const second = new Promise<void>((resolve) => {
      watchUnread(
        view,
        (count) => {
          counts.push(count);
          if (counts.length === 2) {
            resolve();
          }
        },
        ticks.every,
      );
    });

    ticks.tick();
    await Promise.resolve();
    ticks.tick();
    await second;

    expect(counts).toEqual([2, 0]);
  });

  it("reports a page that gives no count, and tries again on the next tick", async () => {
    const ticks = byHand();
    const refusal = new DOMException("navigating", "InvalidStateError");
    const view = pageAnswering(
      () => Promise.reject(refusal),
      () => Promise.resolve(1),
    );
    const heard: unknown[] = [];
    const counted = new Promise<void>((resolve) => {
      watchUnread(
        view,
        (count) => {
          heard.push(count);
          resolve();
        },
        ticks.every,
        (error) => {
          heard.push(error);
          ticks.tick();
        },
      );
    });

    ticks.tick();
    await counted;

    expect(heard).toEqual([refusal, 1]);
  });

  it("stops counting when stopped", () => {
    const ticks = byHand();
    const { asked, view } = counting();
    const stop = watchUnread(view, () => undefined, ticks.every);

    stop();
    ticks.tick();
    view.dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));

    expect(asked()).toBe(0);
  });
});

describe(watchUnreadWith, () => {
  it("counts Messages' unread conversations on each tick", async () => {
    const hand = byHand();
    const counts: number[] = [];
    const asked: string[] = [];
    watchUnreadWith(
      (selector) => {
        asked.push(selector);
        return Promise.resolve(asked.length);
      },
      (count) => {
        counts.push(count);
      },
      hand.every,
    );

    hand.tick();
    hand.tick();
    await Promise.resolve();

    expect(asked).toEqual([UNREAD_CONVERSATIONS, UNREAD_CONVERSATIONS]);
    expect(counts).toEqual([1, 2]);
  });

  it("reports a count the window did not give, and stops when asked", async () => {
    const hand = byHand();
    const missed: unknown[] = [];
    const stop = watchUnreadWith(
      () => Promise.reject(new Error("navigated")),
      () => undefined,
      hand.every,
      (error) => {
        missed.push(error);
      },
    );

    hand.tick();
    await Promise.resolve();
    await Promise.resolve();
    stop();
    hand.tick();

    expect(missed).toHaveLength(1);
  });
});
