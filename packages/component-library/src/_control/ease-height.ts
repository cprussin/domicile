import type { RefCallback } from "react";
import { useCallback } from "react";
import { token } from "../../styled-system/tokens";

/** Height properties whose transition in a popup's content moves its edge. */
const HEIGHTS = new Set(["block-size", "height", "max-block-size"]);

/** `overflow-y` values that scroll. */
const SCROLLS = new Set(["auto", "scroll"]);

/** A change of at most this many pixels jumps: too little to see eased. */
const UNSEEN_PX = 1;

/** A height ease under way: its animation and the height it eases to. */
type Easing = { animation: Animation; to: number };

/**
 * Eases `popup`'s height to its content's whenever that grows or shrinks, such
 * as when rows are cleared, rather than letting it jump: open on the smooth
 * spring, shut on the snappy one, as a `ListRow` drawer does. Content that
 * eases its own height, such as that drawer, already moves the edge smoothly,
 * so it is left to.
 *
 * Content that changes while it eases is followed at once, every frame: the
 * ease turns toward the new height from where it is, or, when the content
 * eases its own height, stops and lets the content move the edge. Left to
 * finish first, the panel would hold its height and then move late.
 *
 * Its scrollbars hide while it eases, as `data-easing-height`, unless its
 * content overflows once eased: a part that fits at rest would otherwise
 * scroll while the panel is shorter than it on the way.
 *
 * Returns the function that stops it.
 */
export const easeHeight = (popup: HTMLElement): (() => void) => {
  const state: {
    easing?: Easing | undefined;
    frame?: number;
    height?: number;
  } = {};
  const stopped = () => {
    state.easing = undefined;
    delete popup.dataset.easingHeight;
  };
  /** Eases from `from` to the height `popup` is laid out at now. */
  const start = (from: number) => {
    const to = popup.offsetHeight;
    state.height = to;
    if (
      Math.abs(to - from) > UNSEEN_PX &&
      popup.closest("[data-reduced-motion]") === null &&
      !easesOwnHeight(popup)
    ) {
      // Read before easing starts, which lays it out at `from`.
      if (overflows(popup)) {
        delete popup.dataset.easingHeight;
      } else {
        popup.dataset.easingHeight = "";
      }
      const easing = { animation: eased(popup, from, to), to };
      state.easing = easing;
      const done = () => {
        if (state.easing === easing) {
          stopped();
        }
      };
      easing.animation.finished.then(done, done);
      state.frame = requestAnimationFrame(follow);
    }
  };
  /** Each frame of an ease, turns it toward the content's height if that moved. */
  const follow = () => {
    const easing = state.easing;
    if (easing !== undefined) {
      const effect = easing.animation.effect;
      if (!(effect instanceof KeyframeEffect)) {
        throw new Error("easeHeight: an ease without keyframes");
      }
      const shown = popup.offsetHeight;
      const keyframes = effect.getKeyframes();
      // Laid out without the ease, for the content's own height.
      effect.setKeyframes([]);
      if (Math.abs(popup.offsetHeight - easing.to) <= UNSEEN_PX) {
        effect.setKeyframes(keyframes);
        state.frame = requestAnimationFrame(follow);
      } else {
        easing.animation.cancel();
        stopped();
        start(shown);
      }
    }
  };
  const observer = new ResizeObserver(() => {
    if (state.easing === undefined) {
      const from = state.height;
      if (from === undefined) {
        state.height = popup.offsetHeight;
      } else {
        start(from);
      }
    }
  });
  observer.observe(popup);
  return () => {
    observer.disconnect();
    if (state.frame !== undefined) {
      cancelAnimationFrame(state.frame);
    }
    state.easing?.animation.cancel();
  };
};

/**
 * Eases `popup`'s height from `from` to `to`. Started before the frame is
 * drawn, so the jump to `to` is never seen.
 */
const eased = (popup: HTMLElement, from: number, to: number): Animation => {
  const spring = to > from ? "smooth" : "snappy";
  // main-thread animation: eases once to its content's new height, moving its
  // edge. A clip would leave the edge jumping.
  return popup.animate(
    { blockSize: [`${from.toString()}px`, `${to.toString()}px`] },
    {
      duration: Number.parseFloat(token(`durations.springs.${spring}`)),
      easing: token(`easings.springs.${spring}`),
    },
  );
};

/** Whether some part of `popup` scrolls what it holds, as laid out now. */
const overflows = (popup: HTMLElement) =>
  [popup, ...popup.querySelectorAll("*")].some(
    (element) =>
      element.scrollHeight > element.clientHeight &&
      SCROLLS.has(getComputedStyle(element).overflowY),
  );

/** Whether something in `popup` is easing its own height. */
const easesOwnHeight = (popup: HTMLElement) =>
  popup
    .getAnimations({ subtree: true })
    .some(
      (animation) =>
        animation instanceof CSSTransition &&
        HEIGHTS.has(animation.transitionProperty),
    );

/**
 * A callback ref that eases its element's height to its content's, as
 * {@link easeHeight}, and passes the element on to `forwarded`.
 */
export const useEasedHeight = <E extends HTMLElement>(
  forwarded?: RefCallback<E> | undefined,
): RefCallback<E> =>
  useCallback<RefCallback<E>>(
    (element) => {
      const detach = forwarded?.(element);
      const stop = element === null ? undefined : easeHeight(element);
      return () => {
        stop?.();
        if (typeof detach === "function") {
          detach();
        } else {
          forwarded?.(null);
        }
      };
    },
    [forwarded],
  );
