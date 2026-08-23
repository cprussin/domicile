// The one gesture this desktop has: hold Alt and drag a window, which either
// moves it or resizes it depending on the button. Pure, so the arithmetic that
// decides where a window lands is testable without a pointer.

import type { WindowBox } from "./window-box";

/**
 * The smallest a resize can leave a window.
 *
 * Not politeness: dragging the corner past the origin would give the window a
 * negative size, which is not something a client can be configured to — and a
 * window with no area has no corner left to drag back out.
 */
const MINIMUM_SIZE = 32;

/** Where the pointer is, in the same CSS pixels a {@link WindowBox} is in. */
export type PointerPosition = { x: number; y: number };

export enum DragKind {
  Move,
  Resize,
}

export const Drag = {
  /** Carry the whole window with the pointer. */
  Move: (box: WindowBox, from: PointerPosition) => ({
    box,
    from,
    kind: DragKind.Move as const,
  }),
  /** Drag the window's bottom right corner, leaving its origin where it is. */
  Resize: (box: WindowBox, from: PointerPosition) => ({
    box,
    from,
    kind: DragKind.Resize as const,
  }),
};

/**
 * A drag in progress: what the window looked like when it was grabbed, and
 * where the pointer was. Both are the state of the gesture at its start rather
 * than its latest step, so every move is measured from the grab — a drag made
 * of many small steps cannot accumulate rounding the way one made of deltas
 * would.
 */
export type Drag = ReturnType<(typeof Drag)[keyof typeof Drag]>;

/** Where the dragged window sits once the pointer has reached `to`. */
export const dragTo = (drag: Drag, to: PointerPosition): WindowBox => {
  const dx = to.x - drag.from.x;
  const dy = to.y - drag.from.y;
  switch (drag.kind) {
    case DragKind.Move: {
      return {
        ...drag.box,
        left: drag.box.left + dx,
        top: drag.box.top + dy,
      };
    }
    case DragKind.Resize: {
      return {
        ...drag.box,
        height: Math.max(MINIMUM_SIZE, drag.box.height + dy),
        width: Math.max(MINIMUM_SIZE, drag.box.width + dx),
      };
    }
  }
};
