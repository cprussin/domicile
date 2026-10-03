import { Button } from "@domicile/component-library/Button";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cva, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TitleFocus } from "./title-focus";
import type { TabLayout } from "./tree/frames";
import type { WindowMotion } from "./window-motion";
import { isLeaving } from "./window-motion";
import {
  clickThroughStyles,
  collapsedAlong,
  edgeStyles,
  movingStyles,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

type Props = {
  /**
   * Whether the window this bar names is all the desk shows, alone or as a
   * tab group — see `alone.ts`. Its edge is not drawn in the accent then.
   */
  alone?: boolean;
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
   * otherwise lie about what pressing it does. And it squares the bar's
   * corners and drops its edge, which are the screen's.
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
  /**
   * A middle click on the bar, which closes a tab the way a browser's does —
   * or `undefined` for a bar it does nothing to.
   */
  onMiddleClick?: (() => void) | undefined;
  /**
   * A press on the bar: how a drag of it starts, for a window that can be
   * dragged by it, and the user reaching for the window a tab names.
   */
  onPointerDown?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  /**
   * What the open tab of its tabbed container says about the keyboard, for a
   * tab that is not the open one: a line is drawn under this one in that
   * tab's edge color, so the edge along the top of the window the strip opens
   * onto runs under every tab. `undefined` for every other bar.
   */
  openTab?: TitleFocus | undefined;
  rect: Rect;
  /**
   * The shuffle the window it names is playing while it trades places with another float in
   * the stack — see `shuffledBy` — or `undefined` while it is not.
   */
  restack?: Restack | undefined;
  /**
   * Which way the tabs this bar is one of run, which is the way it closes up
   * — see `collapsedAlong` — or `undefined` for a bar of a window's own.
   */
  tabbed?: TabLayout | undefined;
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
  alone = false,
  depth,
  dragging,
  focus,
  frame,
  fullscreen,
  motion,
  onClose,
  onContextMenu,
  onFullscreen,
  onMiddleClick,
  onMotionEnded,
  onPointerDown,
  openTab,
  rect,
  restack,
  tabbed,
  title,
  window,
}: Props) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: a title bar is not a control and is not being made into one — the press says the user reached for the window it names, which is what raises a window in any desktop, and the two buttons inside it are what a keyboard reaches
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same press, and the same reason: what it reports is which window the user is working in
  <div
    className={cx(
      barStyles({
        alone,
        focus,
        openTab: openTab ?? "none",
        tab: tabbed !== undefined,
      }),
      // Neither a line nor rounded corners around the screen's own edge.
      !fullscreen && edgeStyles,
      !fullscreen && topCornerStyles,
      movingStyles({ motion }),
      // The window this names has gone, and what is drawn is where it was.
      isLeaving(motion) && clickThroughStyles,
      settlingStyles({ dragging }),
    )}
    // Which of the three this is, as an attribute as well as a color: the
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
    onAuxClick={(event) => {
      if (event.button === MIDDLE_BUTTON) {
        onMiddleClick?.();
      }
    }}
    onContextMenu={onContextMenu}
    onPointerDown={onPointerDown}
    style={{
      ...placedAt(rect, depth),
      ...scaledAbout(frame, rect),
      ...shuffledBy(restack),
      ...collapsedAlong(tabbed),
    }}
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
        variant="ghost"
      >
        {fullscreen ? (
          <CornersInIcon size={14} />
        ) : (
          <CornersOutIcon size={14} />
        )}
      </Button>
      <Button label="Close" onClick={onClose} size="sm" variant="ghost">
        <XIcon size={14} />
      </Button>
    </span>
  </div>
);

/**
 * sway's three client colors, in the one place a window says which it is.
 *
 * **What finds the window at a glance is the ring around it** — see
 * `SelectionRing`. The bar only has to agree with it, and to go on saying
 * where the keyboard is once the ring has grown out to a group: the card
 * under an edge in the accent, and a heavier face. The card is the address
 * bar's ground, so the focused bar reads as the top of the window it names;
 * every other bar sinks below it to the page's own ground.
 *
 * Every state names every one of the four rather than overriding one of them.
 * Two rules setting `border-color` on one element are decided by the order
 * Panda happens to emit them in, which is not a thing to make a desktop's
 * focus indicator depend on.
 */
const barStyles = cva({
  base: hstack.raw({
    gap: 1.5,
    justify: "space-between",
    overflow: "hidden",
    // A bar thirty pixels tall with an eleven pixel name on it: what the text
    // needs to clear the rounded corner, and no more.
    paddingInlineEnd: 0.5,
    paddingInlineStart: 2,
    position: "absolute",
  }),
  // A window alone on the desk has nothing to be picked out from, so its
  // edge is the resting one, as the ring and its frame are — see `alone.ts`.
  // `cva` merges this over the variant into one style before it makes a
  // class, so the override is not left to the order Panda emits rules in.
  compoundVariants: [
    {
      alone: true,
      css: { borderColor: "borderStrong" },
      focus: "focused",
    },
    // A tab whose window is hidden is a thing to click, so the pointer lifts it
    // halfway to the card an open tab sits on — short of it, so it is not
    // taken for the open one.
    {
      css: {
        _hover: {
          backgroundColor:
            "color-mix(in oklab, {colors.card} 50%, {colors.background})",
          color: "foreground",
        },
      },
      focus: "resting",
      tab: true,
    },
    {
      alone: true,
      css: { borderBlockEndColor: "borderStrong" },
      openTab: "focused",
    },
  ],
  variants: {
    alone: {
      false: {},
      true: {},
    },
    focus: {
      focused: {
        backgroundColor: "card",
        borderColor: "accent",
        color: "foreground",
        // Set in a heavier face as well, which is the half of standing out
        // that survives a user who cannot tell the accent from the card.
        fontWeight: "medium",
      },
      // And every other bar recedes rather than competing: the window under it
      // is what the user is looking at.
      resting: {
        backgroundColor: "background",
        borderColor: "borderStrong",
        color: "muted",
        fontWeight: "normal",
      },
      // A container's open tab, with the keyboard somewhere else: raised to
      // the card and set in the heavier face, but without the accent that
      // would make it a second window claiming the keystrokes.
      selected: {
        backgroundColor: "card",
        borderColor: "borderStrong",
        color: "foreground",
        fontWeight: "medium",
      },
    },
    // The line under the bar, which only a tab its container is not showing
    // has: there the strip meets the top of the window the open tab names,
    // and the line is that edge, in the open tab's color — the accent while
    // that window is being worked in, the resting edge otherwise. Every other
    // bar has none: the frame's line is one line, the bar carrying the top and
    // the sides down to where the window picks them up. It still takes the
    // line's room, though, or opening a tab would move its contents down by it.
    openTab: {
      focused: {
        borderBlockEndColor: "accent",
        borderBlockEndWidth: "1px",
      },
      none: {
        borderBlockEndColor: "transparent",
        borderBlockEndWidth: "1px",
      },
      resting: {
        borderBlockEndColor: "borderStrong",
        borderBlockEndWidth: "1px",
      },
      selected: {
        borderBlockEndColor: "borderStrong",
        borderBlockEndWidth: "1px",
      },
    },
    // Whether this bar is a container's tab rather than a window's own.
    tab: {
      false: {},
      true: {},
    },
  },
});

/**
 * Rounded at the top and square at the bottom, because the bottom of a frame
 * is the window's contents, which round their own — see `bottomCornerStyles`.
 * A radius on the underside of this would cut a notch out of the seam between
 * the two rather than rounding anything. Not on a window filling the screen,
 * whose corners are the screen's.
 */
const topCornerStyles = css({
  borderStartEndRadius: "lg",
  borderStartStartRadius: "lg",
});

// The two of them touching, which is what reads as one group at the end of a
// bar thirty pixels tall: each is already an icon in its own padded box.
const controlStyles = hstack({ gap: 0 });

const titleStyles = css({
  // The config's `fonts.size = 11.0`, which is between two tokens on the
  // scale; a rem rather than a px literal, the way every other off-scale
  // length here is written.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
