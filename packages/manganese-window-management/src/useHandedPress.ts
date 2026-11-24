import { useEffectEvent, useLayoutEffect, useRef } from "react";

import type { Press, PressOn } from "./handed-drag";

/**
 * Starts a grab's drag from `handed`, a press a client handed over, as though
 * it had landed on the grab's element. Returns the ref for that element.
 * `Stage` hands each press to one grab, once.
 */
export const useHandedPress = (
  handed: Press | undefined,
  onPress: (press: PressOn) => void,
) => {
  const sheet = useRef<HTMLDivElement>(null);
  const press = useEffectEvent((held: Press, on: Element) => {
    onPress({ ...held, currentTarget: on });
  });
  // A layout effect, so the drag takes the pointer before the next move.
  useLayoutEffect(() => {
    if (handed !== undefined && sheet.current !== null) {
      press(handed, sheet.current);
    }
  }, [handed]);
  return sheet;
};
