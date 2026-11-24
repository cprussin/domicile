/** What {@link slowEveryAnimation} needs of the page. */
export type SlowedPage = {
  cancelAnimationFrame: (handle: number) => void;
  getAnimations: () => readonly { playbackRate: number }[];
  requestAnimationFrame: (callback: (time: number) => void) => number;
};

const DOCUMENT_PAGE: SlowedPage = {
  cancelAnimationFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  getAnimations: () => document.getAnimations(),
  requestAnimationFrame: (callback) => requestAnimationFrame(callback),
};

/**
 * Plays every CSS animation and transition on `page` at `rate`: those running
 * now, and each one that starts later, from its first frame. Returns a stop.
 *
 * Reading the animations flushes style, so a transition the caller just
 * caused is slowed before it draws.
 */
export const slowEveryAnimation = (
  rate: number,
  page: SlowedPage = DOCUMENT_PAGE,
): (() => void) => {
  const slow = () => {
    for (const animation of page.getAnimations()) {
      if (animation.playbackRate !== rate) {
        animation.playbackRate = rate;
      }
    }
  };
  const tick = () => {
    slow();
    handle = page.requestAnimationFrame(tick);
  };
  slow();
  let handle = page.requestAnimationFrame(tick);
  return () => {
    page.cancelAnimationFrame(handle);
  };
};
