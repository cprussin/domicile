import type { Display } from "@domicile/component-library/display-source";

import { css, cx } from "../../../styled-system/css";
import { placedAt } from "../window-styles";
import type { Float } from "./float";
import { rectOf } from "./float";
import { useFloatDrag } from "./useFloatDrag";

type Props = {
  /** How it stacks, which is the depth of the window it covers. */
  depth: number;
  /** The screen it is over, which says what a drag's pixels are worth. */
  display: Display;
  float: Float;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  /** Whether taking hold now would resize the window rather than move it. */
  resizes: boolean;
};

/**
 * The sheet the pointer lands on while the desktop's modifier is held, over
 * one floating window.
 *
 * A window is an `<app>`, and the pointer over one belongs to the client
 * behind it — that is the whole point of Domicile. So a drag cannot be handled
 * on the window: the shell has to take the mouse back first, which it does by
 * making the window click-through (see `clickThroughStyles`) and putting this
 * over it to catch what falls through.
 *
 * Mounted only while the modifier is held or a drag is running, so a window is
 * an ordinary window the rest of the time. Over the whole frame rather than the
 * surface alone, so a drag started on the title bar resizes like one started
 * anywhere else.
 */
export const FloatGrab = ({
  depth,
  display,
  float,
  resizes,
  ...moves
}: Props) => {
  const { drag, ...handlers } = useFloatDrag({
    display,
    float,
    resizes,
    ...moves,
  });
  return (
    // Presentational, and `aria-hidden` for that reason: everything this
    // offers is offered by the keyboard as well, so there is nothing here a
    // keyboard cannot reach elsewhere.
    <div
      aria-hidden
      className={cx(
        grabStyles,
        (drag?.resizes ?? resizes) ? resizeStyles : moveStyles,
      )}
      // Which window this sheet belongs to, which is a fact the SDK asks for
      // rather than a styling hook: a press here lands off every `<app>`, and
      // left unanswered that is the chrome taking the keyboard off the window
      // the user has just taken hold of. See `AppWindow`.
      data-window={float.id}
      style={placedAt(rectOf(float), depth)}
      {...handlers}
    />
  );
};

const grabStyles = css({ position: "absolute" });

const moveStyles = css({ cursor: "move" });

// The corner it is driven from is the bottom-right one, which is the direction
// this arrow points.
const resizeStyles = css({ cursor: "nwse-resize" });
