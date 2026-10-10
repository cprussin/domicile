import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { Direction } from "../direction";
import type { Rect } from "../rect";
import { sameRect } from "../rect";
import type { Aim, Corner, DropTargets } from "./aim";
import { AimKind, aimAt, cornerOf } from "./aim";

/** A drag in progress, fixed when it started. See `useFloatDrag`. */
type Drag = {
  /** What the pointer is over: a drop it would land, or a strip move made. */
  aim: Aim | undefined;
  /** The edges a resize drags. */
  corner: Corner | undefined;
  /** The windows it moves. See `aimAt`. */
  dragged: readonly string[];
  /** The pointer at the last move; the next delta is measured from it. */
  last: { x: number; y: number };
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (aim: Aim) => void;
  onStretch: (edge: Direction, by: number) => void;
  /**
   * Whether a move has gone {@link SLOP} from the press. Until then it does not
   * aim, so a click is not a drop.
   */
  pulled: boolean;
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
  /** The windows it moves: one, or every window in a group. */
  dragged: readonly string[];
  /** The window's box; the pointer's quarter picks the resize corner. */
  frame: Rect;
  /** Reports where a drop would land, for drawing. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (aim: Aim) => void;
  /** The window was taken hold of, to resize it or else to move it. */
  onGrab: (resizing: boolean) => void;
  /** An edge dragged `by` pixels, rightwards or downwards. */
  onStretch: (edge: Direction, by: number) => void;
  /** Whether a drag started now resizes instead of moves. */
  resizes: boolean;
  /** What it can be dropped on, on every screen. */
  targets: DropTargets;
};

/**
 * Moves or resizes a tiled window by Meta+drag, like sway's
 * `floating_modifier` drag.
 *
 * A move retiles only on drop (see `aim.ts`), except a tab moving along its
 * strip, which moves at once. A resize drags the corner of the pointer's
 * quarter and updates the tree on each move. Listens on `window`, as
 * `useFloatDrag` explains.
 */
export const useTileDrag = ({
  dragged,
  frame,
  onAim,
  onDrop,
  onDropOn,
  onGrab,
  onStretch,
  resizes,
  targets,
}: Options): TileDrag => {
  const running = useRef<Drag | undefined>(undefined);
  // The targets as drawn now: a tab moving along its strip moves the others.
  const targetsNow = useEffectEvent(() => targets);
  const [drag, setDrag] = useState<{ corner: Corner | undefined } | undefined>(
    undefined,
  );

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const started = running.current;
      if (started !== undefined) {
        running.current = followed(
          started,
          targetsNow(),
          event.clientX,
          event.clientY,
        );
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
        dragged,
        last: { x: event.clientX, y: event.clientY },
        onAim,
        onDrop,
        onDropOn,
        onStretch,
        pulled: false,
      };
      setDrag({ corner });
      onGrab(corner !== undefined);
    },
  };
};

/** The drag with the pointer at `x`, `y`: resized, or re-aimed. */
const followed = (
  drag: Drag,
  targets: DropTargets,
  x: number,
  y: number,
): Drag => {
  const { corner } = drag;
  if (corner === undefined) {
    // `last` stays at the press until pulled, so this is measured from it.
    return drag.pulled || Math.hypot(x - drag.last.x, y - drag.last.y) >= SLOP
      ? aimed(drag, targets, x, y)
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
const aimed = (
  drag: Drag,
  targets: DropTargets,
  x: number,
  y: number,
): Drag => {
  const aim = aimAt(targets, drag.dragged, x, y);
  // Once per slot: the targets update only after the move renders.
  if (aim?.kind === AimKind.Strip && !landsAlike(aim, drag.aim)) {
    drag.onDropOn(aim);
  }
  // Report only changes, to avoid a redraw on every move.
  if (!landsAlike(pending(aim), pending(drag.aim))) {
    drag.onAim(pending(aim));
  }
  return { ...drag, aim, last: { x, y }, pulled: true };
};

/**
 * The drop a release would make, which the indicator shows. A strip move is
 * already made.
 */
const pending = (aim: Aim | undefined): Aim | undefined =>
  aim?.kind === AimKind.Strip ? undefined : aim;

/**
 * Whether two aims put the window in the same place. Each target and edge has
 * its own box, so comparing boxes compares aims.
 */
const landsAlike = (one: Aim | undefined, other: Aim | undefined): boolean =>
  one === undefined || other === undefined
    ? one === other
    : sameRect(one.rect, other.rect);

/** Ends a drag, dropping onto its aim if it has one. */
const dropped = (drag: Drag): void => {
  const aim = pending(drag.aim);
  if (aim !== undefined) {
    drag.onDropOn(aim);
  }
  if (drag.corner === undefined) {
    drag.onAim(undefined);
  }
  drag.onDrop();
};
