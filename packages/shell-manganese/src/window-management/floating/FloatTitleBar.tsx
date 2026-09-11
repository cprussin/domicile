import { Button } from "@domicile/component-library/Button";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

import { css, cx } from "../../../styled-system/css";
import { hstack } from "../../../styled-system/patterns";
import type { Floating } from "../window-state";
import { floatEdgeStyles, floatPlacement } from "../window-styles";
import { barBox } from "./float";
import { useFloatDrag } from "./useFloatDrag";

type Props = {
  floating: Floating;
  /** Whether the user is working in this window, so its bar looks like it. */
  focused: boolean;
  /** Close the window this bar belongs to — what the X does. */
  onClose: () => void;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  title: string;
};

/**
 * A floating window's title bar: what it is called, and the way out of it.
 *
 * Page pixels at the depth of the window they name, so the bar of a window
 * behind another is drawn under the window in front — which is what a bar
 * painted over the whole page could not be.
 *
 * Draggable without a modifier, for the same reason it is chrome at all: the
 * pointer over a client's surface belongs to the client, and the pointer over
 * this belongs to the page. Alt is only needed for the rest of the window. A
 * bar never resizes — the corner a resize is driven from is the opposite one.
 */
export const FloatTitleBar = ({
  floating,
  focused,
  onClose,
  title,
  ...moves
}: Props) => {
  const { drag: _drag, ...handlers } = useFloatDrag({
    float: floating.float,
    onResize: doesNotResize,
    resizes: false,
    ...moves,
  });
  return (
    <div
      className={cx(barStyles, floatEdgeStyles, focused && focusedStyles)}
      style={floatPlacement(barBox(floating.float), floating.depth)}
      {...handlers}
    >
      <span className={titleStyles}>{title}</span>
      {/*
        The press that closes a window must not also take hold of it: the
        pointer capture a drag takes retargets everything after the press, and
        the click that follows would be the bar's rather than the button's.
      */}
      <span
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <Button label="Close" onClick={onClose} size="sm" variant="ghost">
          <XIcon size={14} />
        </Button>
      </span>
    </div>
  );
};

/** A bar has no corner to resize from, so this is never called. */
const doesNotResize = () => {
  throw new Error("float title bar: a bar does not resize its window");
};

const barStyles = hstack({
  background: "card",
  // The frame's line is one line: the bar carries the top and the sides down
  // to where the surface picks them up, and the seam between them is not one.
  borderBlockEndWidth: 0,
  // Rounded at the top only: the client's surface under this has the other two
  // corners, and a bar rounded all the way round would show the desktop
  // through the seam between them.
  borderStartEndRadius: "lg",
  borderStartStartRadius: "lg",
  // The window under it is what says which window is which, so a bar that is
  // not the one being worked in recedes rather than competing with it.
  color: "muted",
  gap: 2,
  justify: "space-between",
  paddingInlineStart: 3,
  position: "absolute",
});

const focusedStyles = css({ color: "foreground" });

const titleStyles = css({
  fontSize: "sm",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
