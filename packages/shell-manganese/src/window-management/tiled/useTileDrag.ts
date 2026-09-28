import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { Direction } from "../direction";
import type { Rect } from "../rect";
import type { Aim, Corner, Target } from "./aim";
import { aimAt, cornerOf } from "./aim";

/**
 * A drag in progress, and everything about it settled when the window was
 * taken hold of — see `useFloatDrag`, whose reasons these are.
 *
 * The windows it can be dropped on are among them: nothing retiles while a
 * window is being moved, so the boxes they were at the press are the boxes
 * they are at the release.
 */
type Drag = {
  /** Where it would land if let go of now, while it is being moved. */
  aim: Aim | undefined;
  /** The edges being moved, while it is being resized. */
  corner: Corner | undefined;
  id: string;
  /** Where the pointer was at the last move, which the next is measured from. */
  last: { x: number; y: number };
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (target: string, edge: Direction | undefined) => void;
  onStretch: (edge: Direction, by: number) => void;
  targets: readonly Target[];
};

/** The secondary button, which resizes whatever it takes hold of. */
const SECONDARY_BUTTON = 2;

export type TileDrag = {
  /**
   * Whether a drag is running, and the corner it is resizing from, or
   * `undefined` for a move.
   */
  drag: { corner: Corner | undefined } | undefined;
  /** Swallow the menu the secondary button would otherwise open. */
  onContextMenu: (event: { preventDefault: () => void }) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  /** The window's whole box, whose quarters say which corner a resize drives. */
  frame: Rect;
  id: string;
  /** Where it would land if let go of now, to be drawn. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (target: string, edge: Direction | undefined) => void;
  onGrab: () => void;
  /** An edge of the window dragged `by` pixels, rightwards or downwards. */
  onStretch: (edge: Direction, by: number) => void;
  /** Whether taking hold now would resize the window rather than move it. */
  resizes: boolean;
  /** The tiled windows on this screen, which it can be dropped on. */
  targets: readonly Target[];
};

/**
 * Turning pointer events into where a tiled window goes: sway's
 * `floating_modifier` drag, on a window in the tree.
 *
 * A move is a window picked up and put down: nothing retiles until it is let
 * go of, over the window it is dropped on — see `aim.ts`. A resize drags the
 * two edges of the quarter of the window it took hold of, and the tree
 * follows the pointer move by move.
 *
 * **The rest of the drag is the window's, not the element's**, and the drag
 * is a ref beside state that is only what to draw — both for the reasons
 * `useFloatDrag` gives.
 */
export const useTileDrag = ({
  frame,
  id,
  onAim,
  onDrop,
  onDropOn,
  onGrab,
  onStretch,
  resizes,
  targets,
}: Options): TileDrag => {
  const running = useRef<Drag | undefined>(undefined);
  const [drag, setDrag] = useState<{ corner: Corner | undefined } | undefined>(
    undefined,
  );

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const started = running.current;
      if (started !== undefined) {
        running.current = followed(started, event.clientX, event.clientY);
      }
    };
    // Idempotent, because both a release and a cancel can arrive for one
    // drag — see `useFloatDrag`.
    const ended = () => {
      const started = running.current;
      if (started !== undefined) {
        running.current = undefined;
        setDrag(undefined);
        dropped(started);
      }
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", ended);
    window.addEventListener("pointercancel", ended);
    return () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", ended);
      window.removeEventListener("pointercancel", ended);
    };
  }, []);

  return {
    drag,
    onContextMenu: (event) => {
      event.preventDefault();
    },
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const corner =
        resizes || event.button === SECONDARY_BUTTON
          ? cornerOf(frame, event.clientX, event.clientY)
          : undefined;
      running.current = {
        aim: undefined,
        corner,
        id,
        last: { x: event.clientX, y: event.clientY },
        onAim,
        onDrop,
        onDropOn,
        onStretch,
        targets,
      };
      setDrag({ corner });
      onGrab();
    },
  };
};

/** The drag with the pointer at `x`, `y`: stretched, or aimed somewhere new. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const { corner } = drag;
  if (corner === undefined) {
    const aim = aimAt(drag.targets, drag.id, x, y);
    // Only when it is somewhere new: every move would otherwise redraw the
    // desktop to say the same thing.
    if (aim?.id !== drag.aim?.id || aim?.edge !== drag.aim?.edge) {
      drag.onAim(aim);
    }
    return { ...drag, aim, last: { x, y } };
  } else {
    const dx = x - drag.last.x;
    const dy = y - drag.last.y;
    if (dx !== 0) {
      drag.onStretch(corner.horizontal, dx);
    }
    if (dy !== 0) {
      drag.onStretch(corner.vertical, dy);
    }
    return { ...drag, last: { x, y } };
  }
};

/** A drag let go of: put down where it was aimed, if anywhere, and ended. */
const dropped = (drag: Drag): void => {
  const { aim } = drag;
  if (aim !== undefined) {
    drag.onDropOn(aim.id, aim.edge);
  }
  if (drag.corner === undefined) {
    drag.onAim(undefined);
  }
  drag.onDrop();
};
