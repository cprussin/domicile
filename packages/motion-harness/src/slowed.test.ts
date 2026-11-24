import { describe, expect, it } from "bun:test";

import type { SlowedPage } from "./slowed";
import { slowEveryAnimation } from "./slowed";

/** A page whose frames run when `frame` is called. */
const fakePage = (animations: { playbackRate: number }[]) => {
  const frames = new Map<number, () => void>();
  let next = 0;
  const page: SlowedPage = {
    cancelAnimationFrame: (handle) => {
      frames.delete(handle);
    },
    getAnimations: () => animations,
    requestAnimationFrame: (callback) => {
      next += 1;
      frames.set(next, () => {
        callback(0);
      });
      return next;
    },
  };
  const frame = () => {
    const due = [...frames.entries()];
    frames.clear();
    for (const [, run] of due) {
      run();
    }
  };
  return { frame, page };
};

describe("slowEveryAnimation", () => {
  it("slows the animations running now and those that start later", () => {
    const animations = [{ playbackRate: 1 }];
    const { frame, page } = fakePage(animations);
    slowEveryAnimation(0.1, page);
    expect(animations.map(({ playbackRate }) => playbackRate)).toEqual([0.1]);
    animations.push({ playbackRate: 1 });
    frame();
    expect(animations.map(({ playbackRate }) => playbackRate)).toEqual([
      0.1, 0.1,
    ]);
  });

  it("leaves animations alone once stopped", () => {
    const animations: { playbackRate: number }[] = [];
    const { frame, page } = fakePage(animations);
    const stop = slowEveryAnimation(0.1, page);
    stop();
    animations.push({ playbackRate: 1 });
    frame();
    expect(animations.map(({ playbackRate }) => playbackRate)).toEqual([1]);
  });
});
