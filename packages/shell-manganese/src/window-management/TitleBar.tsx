import { Button } from "@domicile/component-library/Button";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cva, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import type { TitleFocus } from "./title-focus";
import type { WindowMotion } from "./window-motion";
import { isLeaving } from "./window-motion";
import {
  clickThroughStyles,
  movingStyles,
  placedAt,
  scaledAbout,
  settlingStyles,
} from "./window-styles";

type Props = {
  /** How it stacks: the depth of the window it names. */
  depth: number;
  /**
   * Whether the user has hold of the window this bar names.
   *
   * A window is two elements — this and the contents under it — and both are
   * written at a new box on every move of a drag. So both take that box
   * outright: a bar that eased towards each one instead would trail the
   * pointer that is holding it, and pull away from the window it names.
   */
  dragging: boolean;
  /** What this bar says about the keyboard — see `title-focus.ts`. */
  focus: TitleFocus;
  /**
   * The whole box of the window this bar names, which both halves of that
   * window turn about — see {@link scaledAbout}. It is this bar's own box for
   * a tab, which is the whole of what such a window has on screen.
   */
  frame: Rect;
  /**
   * Whether the window this bar names already has the screen, which is what
   * the same button offers to give back.
   *
   * The bar is drawn over a fullscreen window rather than hidden under it —
   * see `placement.ts` — so this is the one control on the desktop that would
   * otherwise lie about what pressing it does.
   */
  fullscreen: boolean;
  /**
   * What the window this bar names is doing, which the bar does with it: the
   * two are separate elements, and a frame whose halves moved differently
   * would come apart while the user watched.
   */
  motion: WindowMotion;
  /** Close the window this bar belongs to — what the X does. */
  onClose: () => void;
  /**
   * Fill the screen with the window this bar belongs to, or give the screen
   * back when it already has it: `fullscreen`, which is what `mod+f` is bound
   * to and what the maximize button does.
   */
  onFullscreen: () => void;
  /** Called when it has played that motion all the way out. */
  onMotionEnded: () => void;
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
  dragging,
  focus,
  frame,
  fullscreen,
  motion,
  onClose,
  onContextMenu,
  onFullscreen,
  onMotionEnded,
  onPointerDown,
  onReach,
  rect,
  title,
  window,
}: Props) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: a title bar is not a control and is not being made into one — the press says the user reached for the window it names, which is what raises a window in any desktop, and the two buttons inside it are what a keyboard reaches
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same press, and the same reason: what it reports is which window the user is working in
  <div
    className={cx(
      barStyles({ focus }),
      movingStyles({ motion }),
      // The window this names has gone, and what is drawn is where it was.
      isLeaving(motion) && clickThroughStyles,
      settlingStyles({ dragging }),
    )}
    // Which of the three this is, as an attribute as well as a colour: the
    // desktop's own state is worth being able to read off the element, in
    // devtools and in a test, rather than only off a hashed class name.
    data-focus={focus}
    // What it is doing, as an attribute as well as an animation: the desktop's
    // own state is worth being able to read off the element.
    data-motion={motion}
    // The window this bar belongs to: a press on it lands off every `<app>`,
    // and left unanswered that is the chrome taking the keyboard off the
    // window the user has just taken hold of. See `AppWindow`.
    data-window={window}
    // Nothing a keyboard can reach, for as long as it is only being drawn: the
    // X on a window that has closed is a control that does nothing.
    inert={isLeaving(motion)}
    // Its own rather than the Close button's on its way up the document.
    onAnimationEnd={(event) => {
      if (event.target === event.currentTarget) {
        onMotionEnded();
      }
    }}
    onContextMenu={onContextMenu}
    onPointerDown={(event) => {
      onReach();
      onPointerDown?.(event);
    }}
    style={{ ...placedAt(rect, depth), ...scaledAbout(frame, rect) }}
  >
    <span className={titleStyles}>{title}</span>
    {/*
      The press that drives one of these must not also take hold of the
      window: the pointer capture a drag takes retargets everything after the
      press, and the click that follows would be the bar's rather than the
      button's.
    */}
    <span
      className={controlStyles}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <Button
        label={fullscreen ? "Restore" : "Maximize"}
        onClick={onFullscreen}
        size="sm"
        variant={controlVariant(focus)}
      >
        {fullscreen ? (
          <CornersInIcon size={14} />
        ) : (
          <CornersOutIcon size={14} />
        )}
      </Button>
      <Button
        label="Close"
        onClick={onClose}
        size="sm"
        variant={controlVariant(focus)}
      >
        <XIcon size={14} />
      </Button>
    </span>
  </div>
);

/**
 * Which of the library's buttons the controls on a bar in this state want.
 *
 * The focused bar is *filled* with the accent, and `ghost` — the quiet
 * control every other bar wants — draws its icon in `muted`, which is a grey
 * nobody can find on it. `accent` is the filled control of the same colour:
 * its box disappears into the bar it is on and its icon is the page's own
 * `background`, which is exactly what the title beside it is drawn in. What
 * is left is the hover, which is the only thing a window control has to say
 * before it is pressed.
 */
const controlVariant = (focus: TitleFocus) =>
  focus === "focused" ? "accent" : "ghost";

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
 * Every state names every one of the four rather than overriding one of them.
 * Two rules setting `border-color` on one element are decided by the order
 * Panda happens to emit them in, which is not a thing to make a desktop's
 * focus indicator depend on.
 */
const barStyles = cva({
  base: hstack.raw({
    // The frame's line is one line: the bar carries the top and the sides down
    // to where the window picks them up, and the seam between them is not one.
    borderBlockEndWidth: 0,
    // Rounded at the top and square at the bottom, because the top two corners
    // are the only ones the page draws: the bottom of a frame is the window's
    // contents, and those are a client's own pixels laid into the page — see
    // `AppWindow`. A radius on the underside of this would cut a notch out of
    // the seam between the two rather than rounding anything.
    borderStartEndRadius: "lg",
    borderStartStartRadius: "lg",
    borderStyle: "solid",
    borderWidth: "1px",
    gap: 2,
    justify: "space-between",
    overflow: "hidden",
    // The controls come off the rounded corner rather than sitting in it.
    paddingInlineEnd: 1,
    paddingInlineStart: 3,
    position: "absolute",
  }),
  variants: {
    focus: {
      focused: {
        backgroundColor: "accent",
        borderColor: "accent",
        color: "background",
        // And its name is set in a heavier face than the rest of the desktop's,
        // which is the half of standing out that survives a user who cannot
        // tell the accent from the card.
        fontWeight: "medium",
      },
      // And every other bar recedes rather than competing: the window under it
      // is what the user is looking at.
      resting: {
        backgroundColor: "card",
        borderColor: "borderStrong",
        color: "muted",
        fontWeight: "normal",
      },
      // A container's open tab, with the keyboard somewhere else: marked as
      // open by its edge and its text, and not mistakable for the fill above.
      selected: {
        backgroundColor: "card",
        borderColor: "accent",
        color: "foreground",
        fontWeight: "medium",
      },
    },
  },
});

// The two of them side by side, close enough to read as one group at the end
// of a bar 30 pixels tall.
const controlStyles = hstack({ gap: 0.5 });

const titleStyles = css({
  // The config's `fonts.size = 11.0`, which is between two tokens on the
  // scale; a rem rather than a px literal, the way every other off-scale
  // length here is written.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
