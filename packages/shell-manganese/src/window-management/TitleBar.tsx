import { Button } from "@domicile/component-library/Button";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import { edgeStyles, placedAt } from "./window-styles";

type Props = {
  /** How it stacks: the depth of the window it names. */
  depth: number;
  /** Whether this is the window being worked in, so its bar looks like it. */
  focused: boolean;
  /** Close the window this bar belongs to — what the X does. */
  onClose: () => void;
  onContextMenu?: ((event: { preventDefault: () => void }) => void) | undefined;
  /** How a drag of the bar starts, for a window that can be dragged by it. */
  onPointerDown?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  /** The user reached for this window by pressing its bar. */
  onReach: () => void;
  rect: Rect;
  title: string;
  /** The window this bar names, which the SDK asks about on a press. */
  window: string;
};

/**
 * A window's title bar: what it is called, and the way out of it.
 *
 * **Every window has one, floating or not.** A tiled window's bar is the strip
 * across the top of its frame; a window in a tabbed or stacking container has
 * its tab instead, which is the same component at a different rectangle. The
 * bar comes *out* of the window's box rather than being added to it, so a
 * window dragged to a size is that size, bar included.
 *
 * Page pixels at the depth of the window they name, so the bar of a window
 * behind another is drawn under the window in front — which is what a bar
 * painted over the whole page could not be.
 *
 * **And the press on the bar is the bar's**, because the page is what
 * hit-tests it: the `<app>` under it never hears one, so nothing about the
 * window below is focused or raised by it. That is the browser's own
 * hit-testing rather than a rectangle the compositor was told about, which is
 * why it sees corner radius, transforms and stacking.
 */
export const TitleBar = ({
  depth,
  focused,
  onClose,
  onContextMenu,
  onPointerDown,
  onReach,
  rect,
  title,
  window,
}: Props) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: a title bar is not a control and is not being made into one — the press says the user reached for the window it names, which is what raises a window in any desktop, and the X inside it is the button a keyboard reaches
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same press, and the same reason: what it reports is which window the user is working in
  <div
    className={cx(barStyles, edgeStyles, focused && focusedStyles)}
    // The window this bar belongs to: a press on it lands off every `<app>`,
    // and left unanswered that is the chrome taking the keyboard off the
    // window the user has just taken hold of. See `AppWindow`.
    data-window={window}
    onContextMenu={onContextMenu}
    onPointerDown={(event) => {
      onReach();
      onPointerDown?.(event);
    }}
    style={placedAt(rect, depth)}
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

const barStyles = hstack({
  background: "card",
  // The frame's line is one line: the bar carries the top and the sides down
  // to where the window picks them up, and the seam between them is not one.
  borderBlockEndWidth: 0,
  // The window under it is what says which window is which, so a bar that is
  // not the one being worked in recedes rather than competing with it.
  color: "muted",
  gap: 2,
  justify: "space-between",
  overflow: "hidden",
  paddingInlineStart: 3,
  position: "absolute",
});

const focusedStyles = css({
  // The accent, because the bar is the only thing that says which of several
  // windows the keyboard is in — sway draws the same line round the border.
  borderColor: "accent",
  color: "foreground",
});

const titleStyles = css({
  // The config's `fonts.size = 11.0`, which is between two tokens on the
  // scale; a rem rather than a px literal, the way every other off-scale
  // length here is written.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
