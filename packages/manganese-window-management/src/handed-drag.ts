// A client's own title bar or border, pressed and dragged, handed to the shell
// to move or resize its window. See docs/WRITING-A-SHELL.md.

/** A press's pointer, button and page position, as its `pointerdown` had them. */
export type Press = {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
};

/** A press for a drag hook to start from, on the element taking the pointer. */
export type PressOn = Press & { currentTarget: Element };

/**
 * A client asked the shell to drag `window` from the press still held on it:
 * a move, or a resize if `resizes`.
 */
export type HandedDrag = {
  press: Press;
  resizes: boolean;
  window: string;
};

/**
 * Follows the page's presses, so a client's move or resize can start from the
 * press that asked for it. A press on an `<app>` bubbles here like any other.
 *
 * `held` is the press whose button is still down, or `undefined`.
 * `onReleased` is called when that press ends. Listens in the capture phase,
 * so nothing that stops the event hides it.
 */
export const followPresses = (
  onReleased: () => void,
): { held: () => Press | undefined; stop: () => void } => {
  let held: Press | undefined;
  const pressed = ({ button, clientX, clientY, pointerId }: PointerEvent) => {
    held = { button, clientX, clientY, pointerId };
  };
  const released = (event: PointerEvent) => {
    if (event.pointerId === held?.pointerId) {
      held = undefined;
      onReleased();
    }
  };
  window.addEventListener("pointerdown", pressed, true);
  window.addEventListener("pointerup", released, true);
  window.addEventListener("pointercancel", released, true);
  return {
    held: () => held,
    stop: () => {
      window.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("pointerup", released, true);
      window.removeEventListener("pointercancel", released, true);
    },
  };
};
