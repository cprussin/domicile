/** A press `element` captured, followed on `window` until it ends. */
type Press = {
  element: Element;
  /** Each move while the press lasts. */
  onMove: (event: PointerEvent) => void;
  /** Once, when the press ends. */
  onEnd: () => void;
  pointerId: number;
};

/**
 * Follows `press` until it ends, then lets go of the pointer and calls
 * `onEnd`. Returns a function that stops following without calling it.
 *
 * Listens on `window`, as `useFloatDrag` explains, and only while the press
 * lasts.
 *
 * The press ends at its release or cancel. The release can also land where
 * this page never hears it, which would leave `element` holding the pointer:
 * its cursor would stay and it would take every later press. So the press also
 * ends when `element` loses the pointer, or at the first move with no button
 * held. Only the first of these ends it, since a browser can send several.
 */
export const followPress = ({
  element,
  onEnd,
  onMove,
  pointerId,
}: Press): (() => void) => {
  const moved = (event: PointerEvent) => {
    if (event.buttons === 0) {
      ended();
    } else {
      onMove(event);
    }
  };
  const stop = () => {
    window.removeEventListener("pointermove", moved);
    window.removeEventListener("pointerup", ended);
    window.removeEventListener("pointercancel", ended);
    element.removeEventListener("lostpointercapture", ended);
  };
  const ended = () => {
    stop();
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    onEnd();
  };
  window.addEventListener("pointermove", moved);
  window.addEventListener("pointerup", ended);
  window.addEventListener("pointercancel", ended);
  element.addEventListener("lostpointercapture", ended);
  return stop;
};
