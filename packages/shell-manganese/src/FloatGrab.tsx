import { css, cx } from "../styled-system/css";
import { frameBox } from "./float";
import type { Floating } from "./shell-state";
import { useFloatDrag } from "./useFloatDrag";
import { floatPlacement } from "./window-styles";

type Props = {
  floating: Floating;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  /** Whether taking hold now would resize the window rather than move it. */
  resizes: boolean;
};

/**
 * The sheet the pointer lands on while Alt is held, over one floating window.
 *
 * A window is a `<domicile-app>` portal, and the pointer over one belongs to
 * the client behind it — that is the whole point of Domicile. So a drag cannot
 * be handled on the window: the shell has to take the mouse back first, which
 * it does by making the window click-through (see `clickThroughStyles`) and
 * putting this over it to catch what falls through.
 *
 * Mounted only while Alt is held or a drag is running, so a window is an
 * ordinary window the rest of the time. Over the whole frame rather than the
 * surface alone, so an Alt+drag started on the title bar resizes like one
 * started anywhere else.
 */
export const FloatGrab = ({ floating, resizes, ...moves }: Props) => {
  const { drag, ...handlers } = useFloatDrag({
    float: floating.float,
    resizes,
    ...moves,
  });
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
      style={floatPlacement(frameBox(floating.float), floating.depth)}
      {...handlers}
    />
  );
};

const grabStyles = css({ position: "absolute" });

const moveStyles = css({ cursor: "move" });

// The corner it is driven from is the bottom-right one, which is the direction
// this arrow points.
const resizeStyles = css({ cursor: "nwse-resize" });
