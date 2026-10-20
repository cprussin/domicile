import { useCallback, useState } from "react";

import type { PlacedFocusBox } from "./placement";

/** A focus box to glow around, and whether focus has left it. */
export type FocusGlowing = {
  box: PlacedFocusBox;
  leaving: boolean;
};

type Glows = {
  lit: PlacedFocusBox | undefined;
  /** The box lit before `lit`, kept until its glow has faded out in place. */
  left: PlacedFocusBox | undefined;
};

/**
 * The glows to draw for focus box `lit`: its own, and the one focus last
 * left, fading out. A box keeps its glow while its windows are the same, so
 * the glow follows a layout change but not a focus change.
 *
 * `onFaded` drops a box focus left, once its glow has faded.
 */
export const useFocusGlows = (
  lit: PlacedFocusBox | undefined,
): {
  glows: readonly FocusGlowing[];
  onFaded: (box: PlacedFocusBox) => void;
} => {
  const [glows, setGlows] = useState<Glows>({ left: undefined, lit });
  // Derived state, updated during render so no frame shows a stale box.
  // Each update converges: the next render finds `lit` already stored.
  if (keyOf(lit) !== keyOf(glows.lit)) {
    setGlows({ left: glows.lit, lit });
  } else if (!sameBox(lit, glows.lit)) {
    setGlows({ ...glows, lit });
  }
  const onFaded = useCallback((box: PlacedFocusBox) => {
    setGlows((now) =>
      keyOf(now.left) === keyOf(box) ? { ...now, left: undefined } : now,
    );
  }, []);
  return {
    glows: [
      ...(glows.left === undefined ? [] : [{ box: glows.left, leaving: true }]),
      ...(lit === undefined ? [] : [{ box: lit, leaving: false }]),
    ],
    onFaded,
  };
};

/**
 * Names a box by the windows inside it, in any order, so reordering a group's
 * tabs keeps its glow.
 */
export const keyOf = (box: PlacedFocusBox | undefined): string | undefined =>
  box?.windows.toSorted().join(" ");

const sameBox = (
  a: PlacedFocusBox | undefined,
  b: PlacedFocusBox | undefined,
): boolean =>
  a?.depth === b?.depth &&
  a?.rect.x === b?.rect.x &&
  a?.rect.y === b?.rect.y &&
  a?.rect.width === b?.rect.width &&
  a?.rect.height === b?.rect.height;
