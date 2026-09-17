import { Button } from "@domicile/component-library/Button";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import type { TitleFocus } from "./title-focus";
import { placedAt } from "./window-styles";

type Props = {
  /** How it stacks: the depth of the window it names. */
  depth: number;
  /** What this bar says about the keyboard — see `title-focus.ts`. */
  focus: TitleFocus;
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
  focus,
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
    className={barStyles({ focus })}
    // Which of the three this is, as an attribute as well as a colour: the
    // desktop's own state is worth being able to read off the element, in
    // devtools and in a test, rather than only off a hashed class name.
    data-focus={focus}
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

/**
 * sway's three client colours, in the one place a window says which it is.
 *
 * **The focused window's bar is filled**, not merely tinted: it is the one
 * thing on a desktop of identical frames that says where the keystrokes are
 * going, and a border a pixel wide is not enough to find at a glance. The fill
 * is the accent and the text on it is the page's own `background`, which is
 * what the component library's own filled controls do — so the pairing is
 * already known to work in both themes.
 *
 * Every state names all three colours rather than overriding one of them.
 * Two rules setting `border-color` on one element are decided by the order
 * Panda happens to emit them in, which is not a thing to make a desktop's
 * focus indicator depend on.
 */
const barStyles = cva({
  base: hstack.raw({
    // The frame's line is one line: the bar carries the top and the sides down
    // to where the window picks them up, and the seam between them is not one.
    borderBlockEndWidth: 0,
    borderStyle: "solid",
    borderWidth: "1px",
    gap: 2,
    justify: "space-between",
    overflow: "hidden",
    paddingInlineStart: 3,
    position: "absolute",
  }),
  variants: {
    focus: {
      focused: {
        backgroundColor: "accent",
        borderColor: "accent",
        color: "background",
      },
      // And every other bar recedes rather than competing: the window under it
      // is what the user is looking at.
      resting: {
        backgroundColor: "card",
        borderColor: "borderStrong",
        color: "muted",
      },
      // A container's open tab, with the keyboard somewhere else: marked as
      // open by its edge and its text, and not mistakable for the fill above.
      selected: {
        backgroundColor: "card",
        borderColor: "accent",
        color: "foreground",
      },
    },
  },
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
