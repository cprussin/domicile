import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

import { token } from "../../styled-system/tokens";
import type { Rect } from "./rect";
import type { Offset, Point } from "./settle";
import { drawnAt, offsetFrom, partway } from "./settle";

/** Reads and plays an element's settle. */
export type Settler = {
  /** How far the element is drawn from its box. */
  offset: (element: Element) => Offset;
  /**
   * Stops the element's settle, then eases it from `offset` to its box. Only
   * stops for `undefined`.
   */
  play: (element: Element, offset: Offset | undefined) => void;
};

/** The box an element was given last, and the origin it scaled about. */
type Placed = { origin: Point; rect: Rect };

/** `T` with every field possibly missing, as for an element off screen. */
type Unknown<T> = { [K in keyof T]: T[K] | undefined };

/**
 * Eases an element from its old box to a new one with `translate` and
 * `scale`, so its box changes once.
 *
 * Changing the box every frame costs a layout every frame, and an `<app>`'s
 * box is its client's size, so its client would draw at every size in
 * between. The engine holds the page's frame until a resized client draws, so
 * the whole desktop would run at the slowest client's pace. `translate` and
 * `scale` run on the compositor thread.
 *
 * Runs before paint, so no frame shows the new box without the offset.
 *
 * @param origin - The element's `transform-origin`, from its box's corner.
 *   `undefined`, like `rect`, when the element is off screen.
 * @param still - Whether the box takes its new place without easing: it
 *   follows the pointer, which easing would make it trail, or it plays a
 *   motion, whose travel `scale` would scale.
 */
export const useSettling = (
  element: RefObject<Element | null>,
  rect: Rect | undefined,
  origin: Point | undefined,
  still: boolean,
  settler: Settler = WEB_ANIMATIONS,
): void => {
  const last = useRef<Placed | undefined>(undefined);
  const { x, y, width, height } = rect ?? {};
  const { x: originX, y: originY } = origin ?? {};
  useLayoutEffect(() => {
    const was = last.current;
    const shown = element.current;
    const now = placedOf({ height, width, x, y }, { x: originX, y: originY });
    last.current = now;
    if (
      shown !== null &&
      was !== undefined &&
      now !== undefined &&
      !sameBox(was.rect, now.rect)
    ) {
      settler.play(
        shown,
        still ? undefined : offsetTo(shown, was, now, settler),
      );
    }
  }, [element, height, originX, originY, settler, still, width, x, y]);
};

/** The box and origin, or `undefined` for an element off screen. */
const placedOf = (
  { height, width, x, y }: Unknown<Rect>,
  origin: Unknown<Point>,
): Placed | undefined => {
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    origin.x === undefined ||
    origin.y === undefined
  ) {
    return undefined;
  } else {
    return {
      origin: { x: origin.x, y: origin.y },
      rect: { height, width, x, y },
    };
  }
};

/** The offset that draws `now` where `element`, placed at `was`, is drawn. */
const offsetTo = (
  element: Element,
  was: Placed,
  now: Placed,
  settler: Settler,
): Offset =>
  offsetFrom(
    drawnAt(was.rect, was.origin, settler.offset(element)),
    now.rect,
    now.origin,
  );

const sameBox = (one: Rect, other: Rect): boolean =>
  one.x === other.x &&
  one.y === other.y &&
  one.width === other.width &&
  one.height === other.height;

/** No offset: the element is drawn at its box. */
const NONE: Offset = { scaleX: 1, scaleY: 1, x: 0, y: 0 };

/** Each element's settle, and the offset it started from. */
const settles = new WeakMap<Element, { animation: Animation; from: Offset }>();

/**
 * The browser's settle: a Web Animation, which leaves the element's CSS
 * `animation` to its motion keyframes.
 *
 * Takes the box transition's timing, so the title bar and the window it tops
 * move together.
 */
const WEB_ANIMATIONS: Settler = {
  // `progress` is eased, and `scale` and `translate` interpolate linearly, so
  // this is where the settle draws the element. `null` outside the settle's
  // run, when it draws nothing.
  offset: (element) => {
    const settle = settles.get(element);
    const progress = settle?.animation.effect?.getComputedTiming().progress;
    return settle === undefined || progress === null || progress === undefined
      ? NONE
      : partway(settle.from, progress);
  },
  play: (element, offset) => {
    settles.get(element)?.animation.cancel();
    settles.delete(element);
    if (offset !== undefined) {
      const animation = element.animate(
        [
          {
            scale: `${offset.scaleX.toString()} ${offset.scaleY.toString()}`,
            translate: `${offset.x.toString()}px ${offset.y.toString()}px`,
          },
          { scale: "1", translate: "0px" },
        ],
        {
          // The shortest duration under reduced motion, as the preset gives
          // the title bar's transitions.
          duration: millisecondsOf(
            document.documentElement.hasAttribute("data-reduced-motion")
              ? token("durations.fastest")
              : token("durations.fast"),
          ),
          easing: token("easings.out"),
        },
      );
      // A canceled settle rejects `finished`. The next settle replaces it, so
      // there is nothing to handle.
      animation.finished.catch(() => {
        /* no-op */
      });
      settles.set(element, { animation, from: offset });
    }
  },
};

/** A duration token's value, such as `150ms`, in milliseconds. */
const millisecondsOf = (duration: string): number => {
  const milliseconds = /^(\d+)ms$/.exec(duration)?.[1];
  if (milliseconds === undefined) {
    throw new Error(`shell: cannot read the duration "${duration}"`);
  } else {
    return Number(milliseconds);
  }
};
