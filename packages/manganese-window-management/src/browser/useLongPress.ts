import type { PointerEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

/** How long a press is held before it counts as long, as Chrome's. */
const LONG_PRESS_MS = 500;

/** `PointerEvent.button` for the primary button. */
const PRIMARY_BUTTON = 0;

type Timer = ReturnType<typeof setTimeout> | undefined;

/**
 * Handlers that call `onLongPress` once the primary button is held on an
 * element, and `onClick` for a click that was not one. A long press's own
 * release clicks too, and that click is dropped.
 */
export const useLongPress = (onLongPress: () => void, onClick: () => void) => {
  const timer = useRef<Timer>(undefined);
  // Whether the press in progress went long, so its click is dropped.
  const pressedLong = useRef(false);

  useEffect(
    () => () => {
      cancel(timer);
    },
    [],
  );

  const stop = () => {
    cancel(timer);
  };

  return {
    onClick: () => {
      if (pressedLong.current) {
        pressedLong.current = false;
      } else {
        onClick();
      }
    },
    onPointerCancel: stop,
    onPointerDown: (event: PointerEvent) => {
      if (event.button === PRIMARY_BUTTON) {
        pressedLong.current = false;
        cancel(timer);
        timer.current = setTimeout(() => {
          timer.current = undefined;
          pressedLong.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      }
    },
    onPointerLeave: stop,
    onPointerUp: stop,
  };
};

/** Stops the pending long press, if any. */
const cancel = (timer: RefObject<Timer>) => {
  clearTimeout(timer.current);
  timer.current = undefined;
};
