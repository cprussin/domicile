import { Button } from "@domicile/component-library/Button";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

import { css, cx } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";
import { barBox } from "./float";
import type { Floating } from "./shell-state";
import { useFloatDrag } from "./useFloatDrag";
import { floatPlacement } from "./window-styles";

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
 * Chrome rather than window, and that is the point of it beyond looking like a
 * window. A bar is page pixels at the depth of the window it names, so a window
 * in front of that one has to be drawn *over* it — which is the one thing a
 * compositor that composites the whole page above every window cannot do.
 * Until the shell declares its depths (`declare_bands`), the bar of a window
 * behind another is drawn on top of the one in front, and this is what makes
 * that visible rather than theoretical.
 *
 * Draggable without a modifier, for the same reason it is chrome at all: the
 * pointer over a client's surface belongs to the client, and the pointer over
 * this belongs to the page. Alt is only needed for the rest of the window,
 * where it does not. A bar never resizes — the corner a resize is driven from
 * is the opposite one.
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
      className={cx(barStyles, focused && focusedStyles)}
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
