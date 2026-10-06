import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { Direction } from "../direction";
import type { Rect } from "../rect";
import type { Aim, Corner, Target } from "./aim";
import { aimAt, cornerOf } from "./aim";

/**
 * A drag in progress, fixed when it started. See `useFloatDrag`.
 *
 * Holds the drop targets too, since nothing retiles during a move.
 */
type Drag = {
  /** Where a move would land if dropped now. */
  aim: Aim | undefined;
  /** The edges a resize drags. */
  corner: Corner | undefined;
  id: string;
  /** The pointer at the last move; the next delta is measured from it. */
  last: { x: number; y: number };
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (target: string, edge: Direction | undefined) => void;
  onStretch: (edge: Direction, by: number) => void;
  /**
   * Whether a move has gone {@link SLOP} from the press. Until then it does not
   * aim, so a click is not a drop.
   */
  pulled: boolean;
  targets: readonly Target[];
};

/** The secondary button, which resizes. */
const SECONDARY_BUTTON = 2;

/**
 * How far, in pixels, the pointer must move from the press before a move
 * aims. Matches GTK's drag threshold.
 */
const SLOP = 8;

export type TileDrag = {
  /**
   * The running drag, if any, with the corner it resizes from (`undefined`
   * for a move).
   */
  drag: { corner: Corner | undefined } | undefined;
  /** Suppresses the context menu, since the right button resizes. */
  onContextMenu: (event: { preventDefault: () => void }) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  /** The window's box; the pointer's quarter picks the resize corner. */
  frame: Rect;
  id: string;
  /** Reports where a drop would land, for drawing. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (target: string, edge: Direction | undefined) => void;
  /** The window was taken hold of, to resize it or else to move it. */
  onGrab: (resizing: boolean) => void;
  /** An edge dragged `by` pixels, rightwards or downwards. */
  onStretch: (edge: Direction, by: number) => void;
  /** Whether a drag started now resizes instead of moves. */
  resizes: boolean;
  /** The tiled windows on this screen it can be dropped on. */
  targets: readonly Target[];
};

/**
 * Moves or resizes a tiled window by Meta+drag, like sway's
 * `floating_modifier` drag.
 *
 * A move retiles only on drop (see `aim.ts`). A resize drags the corner of the
 * pointer's quarter and updates the tree on each move. Listens on `window`, as
 * `useFloatDrag` explains.
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
    // Idempotent: one drag can get both a release and a cancel.
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
        pulled: false,
        targets,
      };
      setDrag({ corner });
      onGrab(corner !== undefined);
    },
  };
};

/** The drag with the pointer at `x`, `y`: resized, or re-aimed. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const { corner } = drag;
  if (corner === undefined) {
    // `last` stays at the press until pulled, so this is measured from it.
    return drag.pulled || Math.hypot(x - drag.last.x, y - drag.last.y) >= SLOP
      ? aimed(drag, x, y)
      : drag;
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

/** The move with the pointer at `x`, `y`, aimed at what is under it. */
const aimed = (drag: Drag, x: number, y: number): Drag => {
  const aim = aimAt(drag.targets, drag.id, x, y);
  // Report only changes, to avoid a redraw on every move.
  if (aim?.id !== drag.aim?.id || aim?.edge !== drag.aim?.edge) {
    drag.onAim(aim);
  }
  return { ...drag, aim, last: { x, y }, pulled: true };
};

/** Ends a drag, dropping onto its aim if it has one. */
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
