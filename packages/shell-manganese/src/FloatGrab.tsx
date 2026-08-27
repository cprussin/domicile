import type { PointerEvent } from "react";
import { useState } from "react";

import { css, cx } from "../styled-system/css";
import type { Float } from "./float";
import { floatPlacement } from "./window-styles";

type Props = {
  /** How far up the float stack the window is, so this sits on top of it. */
  depth: number;
  float: Float;
  /** The user let go. */
  onDrop: () => void;
  /** The user took hold. */
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  /**
   * Whether taking hold now would resize the window rather than move it.
   *
   * Read when the drag starts and then kept: letting go of Shift half way
   * through a resize must not turn it into a move, with the window jumping to
   * wherever the pointer has got to.
   */
  resizes: boolean;
};

/** A drag in progress: where it started, and from what. */
type Drag = {
  /** The window's box when it was taken hold of, which the delta is from. */
  box: Float;
  from: { x: number; y: number };
  resizes: boolean;
};

/**
 * The sheet the pointer lands on while Alt is held, over one floating window.
 *
 * A window is a `<domicile-app>` portal, and the pointer over one belongs to
 * the client behind it — that is the whole point. So a drag cannot be handled
 * on the window: the shell has to take the mouse back first, which it does by
 * making the window click-through (see `clickThroughStyles`) and putting this
 * over it to catch what falls through.
 *
 * Mounted only while Alt is held or a drag is running, so a window is an
 * ordinary window the rest of the time.
 */
export const FloatGrab = ({
  depth,
  float,
  onDrop,
  onGrab,
  onMove,
  onResize,
  resizes,
}: Props) => {
  const [drag, setDrag] = useState<Drag | undefined>(undefined);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    // Captured, so the rest of the drag arrives here even when the pointer
    // leaves this sheet — which it does the moment the window falls behind a
    // fast one, and on every resize that shrinks the window out from under it.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      box: float,
      from: { x: event.clientX, y: event.clientY },
      resizes,
    });
    onGrab();
  };

  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (drag !== undefined) {
      const dx = event.clientX - drag.from.x;
      const dy = event.clientY - drag.from.y;
      if (drag.resizes) {
        onResize(drag.box.width + dx, drag.box.height + dy);
      } else {
        onMove(drag.box.x + dx, drag.box.y + dy);
      }
    }
  };

  const end = () => {
    if (drag !== undefined) {
      setDrag(undefined);
      onDrop();
    }
  };

  return (
    // Presentational, and `aria-hidden` for that reason: everything this
    // offers is offered by the tab rail and by Alt+Tab as well, so there is
    // nothing here a keyboard cannot reach elsewhere.
    <div
      aria-hidden
      className={cx(
        grabStyles,
        (drag?.resizes ?? resizes) ? resizeStyles : moveStyles,
      )}
      onPointerCancel={end}
      onPointerDown={start}
      onPointerMove={track}
      onPointerUp={end}
      style={floatPlacement(float, depth)}
    />
  );
};

const grabStyles = css({ position: "absolute" });

const moveStyles = css({ cursor: "move" });

// The corner it is driven from is the bottom-right one, which is the direction
// this arrow points.
const resizeStyles = css({ cursor: "nwse-resize" });
