import { useEffect, useRef, useState } from "react";

import type { SharedBacklight } from "../readouts/readouts";
import { useSharedWatch } from "../readouts/useSharedWatch";

/** The backlight as a control draws it. */
export type BrightnessControl = {
  /** The level to show, 0 to 1: the one asked for until the desk reports. */
  shown: number;
  /** Ask for a level from 0 to 1. */
  ask: (level: number) => void;
  /** Ask for a level from a slider drag, held until {@link dropped}. */
  drag: (level: number) => void;
  dropped: () => void;
};

/**
 * The backlight's level and a way to change it, or `undefined` until there is
 * a level, so a desktop with no backlight (such as an external monitor) shows
 * no control.
 *
 * Changes go to logind, and the control shows the level `/sys` reports back,
 * as the theme toggle does. During a drag it holds the pointer's value, since
 * readings after earlier requests arrive late.
 */
export const useBrightness = (
  backlight: SharedBacklight,
): BrightnessControl | undefined => {
  const reading = useSharedWatch(backlight.level);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const dragging = useRef(false);

  // Each report, even of the same level, ends a hold outside a drag.
  useEffect(
    () =>
      backlight.level.subscribe(() => {
        if (!dragging.current) {
          setHeld(undefined);
        }
      }),
    [backlight],
  );

  if (reading === undefined) {
    return undefined;
  } else {
    const ask = (level: number) => {
      setHeld(level);
      backlight.set(level);
    };
    return {
      ask,
      drag: (level) => {
        dragging.current = true;
        ask(level);
      },
      dropped: () => {
        dragging.current = false;
      },
      shown: held ?? reading,
    };
  }
};
