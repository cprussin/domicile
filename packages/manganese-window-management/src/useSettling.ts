import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

import { token } from "../styled-system/tokens";
import type { Rect } from "./rect";
import { useHandoffs } from "./SettleHandoffs";
import type { Offset, Point } from "./settle";
import { drawnAt, offsetFrom, partway, uprightAlong } from "./settle";

/** Reads and plays an element's settle. */
export type Settler = {
  /** How far the element is drawn from its box. */
  offset: (element: Element) => Offset;
  /**
   * Stops the element's settle, then eases it from `offset` to its box,
   * keeping each `upright` part at its own size. Only stops for `undefined`.
   */
  play: (
    element: Element,
    offset: Offset | undefined,
    upright: readonly Element[],
  ) => void;
};

/**
 * Marks a part of a settling element, such as a title, kept at its own size
 * while the element scales. It scales back about its `transform-origin`,
 * which should be the edge of the element it keeps to.
 */
export const UPRIGHT = "data-upright";

/** How many steps {@link uprightAlong} samples a settle in. */
const UPRIGHT_STEPS = 12;

/** The box an element was given last, and the origin it scaled about. */
type Placed = { origin: Point; rect: Rect };

/** `T` with every field possibly missing, as for an element off screen. */
type Unknown<T> = { [K in keyof T]: T[K] | undefined };

type Options = {
  element: RefObject<Element | null>;
  /**
   * The element's `transform-origin`, from its box's corner. `undefined`, like
   * `rect`, when the element is off screen.
   */
  origin: Point | undefined;
  /** The element's box, or `undefined` when it is off screen. */
  rect: Rect | undefined;
  settler?: Settler | undefined;
  /**
   * Keys of the part the element draws. An element new in a commit that
   * removed one sharing a key eases from where that one was drawn, as when a
   * tab switch hands a strip to the newly open tab. See `SettleHandoffs`.
   */
  shared?: readonly string[] | undefined;
  /**
   * Whether the box takes its new place without easing: it follows the
   * pointer, which easing would make it trail, or it plays a motion, whose
   * travel `scale` would scale.
   */
  still: boolean;
};

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
 * Every part of a window eases this way, on one timing, so the parts keep
 * together: each edge moves linearly in the eased progress, whatever the
 * part's origin.
 *
 * Runs before paint, so no frame shows the new box without the offset.
 */
export const useSettling = ({
  element,
  origin,
  rect,
  settler = WEB_ANIMATIONS,
  shared = NO_KEYS,
  still,
}: Options): void => {
  const last = useRef<Placed | undefined>(undefined);
  const { x, y, width, height } = rect ?? {};
  const { x: originX, y: originY } = origin ?? {};
  const handoffs = useHandoffs();
  const keys = shared.join("\n");
  useLayoutEffect(() => {
    const was = last.current;
    const shown = element.current;
    const now = placedOf({ height, width, x, y }, { x: originX, y: originY });
    last.current = now;
    if (shown !== null && now !== undefined) {
      if (was === undefined) {
        const from = takenOver(handoffs, keys);
        if (from !== undefined && !still) {
          settler.play(
            shown,
            offsetFrom(from, now.rect, now.origin),
            uprightIn(shown),
          );
        }
      } else if (!sameBox(was.rect, now.rect)) {
        settler.play(
          shown,
          still ? undefined : offsetTo(shown, was, now, settler),
          uprightIn(shown),
        );
      }
    }
  }, [
    element,
    handoffs,
    height,
    keys,
    originX,
    originY,
    settler,
    still,
    width,
    x,
    y,
  ]);
  // Leaves where it is drawn for an element taking over in this commit.
  useLayoutEffect(
    () => () => {
      const shown = element.current;
      const placed = last.current;
      if (handoffs !== undefined && shown !== null && placed !== undefined) {
        const drawn = drawnAt(
          placed.rect,
          placed.origin,
          settler.offset(shown),
        );
        for (const key of keysIn(keys)) {
          handoffs.set(key, drawn);
        }
      }
    },
    [element, handoffs, keys, settler],
  );
};

const NO_KEYS: readonly string[] = [];

/** The parts of `element` kept upright; see {@link UPRIGHT}. */
const uprightIn = (element: Element): readonly Element[] => [
  ...element.querySelectorAll(`[${UPRIGHT}]`),
];

/** The keys `useSettling` joined, so they can be its effects' dependency. */
const keysIn = (keys: string): readonly string[] =>
  keys === "" ? [] : keys.split("\n");

/** Where a part that shared one of `keys` was drawn, if one just went. */
const takenOver = (
  handoffs: ReadonlyMap<string, Rect> | undefined,
  keys: string,
): Rect | undefined =>
  keysIn(keys)
    .map((key) => handoffs?.get(key))
    .find((drawn) => drawn !== undefined);

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

/**
 * Each element's settle, the offset it started from, and its upright parts'
 * animations.
 */
const settles = new WeakMap<
  Element,
  { animation: Animation; from: Offset; upright: readonly Animation[] }
>();

/**
 * The browser's settle: a Web Animation, which leaves the element's CSS
 * `animation` to its motion keyframes.
 *
 * Every part of a window settles on one timing, so the parts move together.
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
  play: (element, offset, upright) => {
    const was = settles.get(element);
    was?.animation.cancel();
    for (const part of was?.upright ?? []) {
      part.cancel();
    }
    settles.delete(element);
    if (offset !== undefined) {
      const timing = settleTiming();
      const animation = settled(element, timing, [
        {
          scale: `${offset.scaleX.toString()} ${offset.scaleY.toString()}`,
          translate: `${offset.x.toString()}px ${offset.y.toString()}px`,
        },
        { scale: "1", translate: "0px" },
      ]);
      // Keyframe offsets are eased progress, as the element's are, so each
      // part keeps pace with it.
      const steps = uprightAlong(offset, UPRIGHT_STEPS).map(
        ({ at, scaleX, scaleY }) => ({
          offset: at,
          scale: `${scaleX.toString()} ${scaleY.toString()}`,
        }),
      );
      settles.set(element, {
        animation,
        from: offset,
        upright: upright.map((part) => settled(part, timing, steps)),
      });
    }
  },
};

/** The shortest duration under reduced motion, as the preset gives others. */
const settleTiming = (): KeyframeAnimationOptions => ({
  duration: millisecondsOf(
    document.documentElement.hasAttribute("data-reduced-motion")
      ? token("durations.fastest")
      : token("durations.fast"),
  ),
  easing: token("easings.out"),
});

/** Plays `keyframes` on `element` as part of a settle. */
const settled = (
  element: Element,
  timing: KeyframeAnimationOptions,
  keyframes: Keyframe[],
): Animation => {
  const animation = element.animate(keyframes, timing);
  // A canceled settle rejects `finished`. The next settle replaces it, so
  // there is nothing to handle.
  animation.finished.catch(() => {
    /* no-op */
  });
  return animation;
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
