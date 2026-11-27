import type { RefCallback } from "react";
import { useCallback } from "react";
import { token } from "../../styled-system/tokens";

/** Height properties whose transition in a popup's content moves its edge. */
const HEIGHTS = new Set(["block-size", "height", "max-block-size"]);

/**
 * Eases `popup`'s height to its content's whenever that grows or shrinks, such
 * as when rows are cleared, rather than letting it jump: open on the smooth
 * spring, shut on the snappy one, as a `ListRow` drawer does. Content that
 * eases its own height, such as that drawer, already moves the edge smoothly,
 * so it is left to. A change while easing is eased to once it ends.
 *
 * Returns the function that stops it.
 */
export const easeHeight = (popup: HTMLElement): (() => void) => {
  const state: { animation?: Animation | undefined; height?: number } = {};
  const observer = new ResizeObserver(() => {
    if (state.animation === undefined) {
      const height = popup.offsetHeight;
      const from = state.height;
      state.height = height;
      if (
        from !== undefined &&
        from !== height &&
        popup.closest("[data-reduced-motion]") === null &&
        !easesOwnHeight(popup)
      ) {
        const animation = eased(popup, from, height);
        state.animation = animation;
        const done = () => {
          state.animation = undefined;
        };
        animation.finished.then(done, done);
      }
    }
  });
  observer.observe(popup);
  return () => {
    observer.disconnect();
    state.animation?.cancel();
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
