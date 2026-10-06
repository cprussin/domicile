import { Button } from "@domicile-desktop/component-library/Button";
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
   * Whether this is a hidden tab, which draws a line under it to continue the
   * top edge of the shown window.
   */
  besideOpenTab?: boolean;
  /** The stacking depth of the window it names. */
  depth: number;
  /**
   * Whether the window is being dragged. Disables easing so the bar keeps up
   * with the pointer and its contents.
   */
  dragging: boolean;
  /** The bar's focus state. See `title-focus.ts`. */
  focus: TitleFocus;
  /**
   * The window's whole box, which bar and contents both scale about. See
   * {@link scaledAbout}. For a tab, this is the tab's own box.
   */
  frame: Rect;
  /**
   * Whether the window is fullscreen. Switches the button to "Restore" and
   * drops the bar's rounded corners and edge.
   */
  fullscreen: boolean;
  /**
   * The window's motion. The bar plays it too, so bar and contents move as
   * one.
   */
  motion: WindowMotion;
  /** Closes the window. */
  onClose: () => void;
  /** Toggles fullscreen, like `mod+f`. */
  onFullscreen: () => void;
  /** Called when `motion` finishes. */
  onMotionEnded: () => void;
  onContextMenu?: ((event: { preventDefault: () => void }) => void) | undefined;
  /** A middle click, which closes a tab as in a browser. */
  onMiddleClick?: (() => void) | undefined;
  /** A press on the bar, which starts a drag or selects a tab's window. */
  onPointerDown?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  rect: Rect;
  /**
   * The restack animation while the window trades places with another float.
   * See `shuffledBy`.
   */
  restack?: Restack | undefined;
  /**
   * The direction of the tab strip, which a closing tab collapses along. See
   * `collapsedAlong`. `undefined` for a window's own bar.
   */
  tabbed?: TabLayout | undefined;
  title: string;
  /** The window this bar names, which `AppWindow` reads on a press. */
  window: string;
};

/**
 * A window's title bar or container tab, with its title and controls.
 *
 * The bar is part of the window's box, not added to it. It is drawn at the
 * window's depth so windows in front cover it. The page hit-tests it, so
 * presses on it never reach the `<app>` below.
 */
export const TitleBar = ({
  besideOpenTab = false,
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
  rect,
  restack,
  tabbed,
  title,
  window,
}: Props) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: a press only raises the window; its buttons are the keyboard-reachable controls
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above
  <div
    className={cx(
      barStyles({
        besideOpenTab,
        focus,
        tab: tabbed !== undefined,
      }),
      !fullscreen && edgeStyles,
      !fullscreen && topCornerStyles,
      movingStyles({ motion }),
      isLeaving(motion) && clickThroughStyles,
      settlingStyles({ dragging }),
    )}
    // Exposed as attributes so devtools and tests can read the state.
    data-focus={focus}
    data-motion={motion}
    // A press here lands outside every `<app>`, so the window is named for
    // the focus handling in `AppWindow`.
    data-window={window}
    // A closed window's buttons would do nothing.
    inert={isLeaving(motion)}
    // Ignore animations bubbling up from the buttons.
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
      A press on a button must not start a drag: drag pointer capture would
      retarget the click to the bar.
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
 * Bar colors for sway's three client states plus `leaf`.
 *
 * The glow around the focused window is the main focus indicator (see
 * `FocusGlow`), so the bar only adds the card background and a heavier
 * weight. No state uses an accent edge.
 *
 * Each state sets all its colors instead of overriding one: two rules on one
 * property would depend on Panda's emit order.
 */
const barStyles = cva({
  base: hstack.raw({
    borderBlockEndWidth: "1px",
    gap: 1.5,
    justify: "space-between",
    overflow: "hidden",
    // Just enough for the title to clear the rounded corner.
    paddingInlineEnd: 0.5,
    paddingInlineStart: 2,
    position: "absolute",
  }),
  // Hovering a hidden tab lightens it halfway to the card, so it is not
  // mistaken for the open tab.
  compoundVariants: [
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
  ],
  variants: {
    // Only hidden tabs show the bottom line. Other bars keep a transparent
    // one so opening a tab does not shift its contents.
    besideOpenTab: {
      false: { borderBlockEndColor: "transparent" },
      true: { borderBlockEndColor: "borderStrong" },
    },
    focus: {
      focused: {
        backgroundColor: "card",
        color: "foreground",
        // Weight as well as color, for users who cannot tell the colors
        // apart.
        fontWeight: "medium",
      },
      // The focused window inside a `focus parent` selection. The group's
      // bars use the card, so this one mixes in the accent.
      leaf: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 45%, {colors.card})",
        color: "foreground",
        fontWeight: "medium",
      },
      resting: {
        backgroundColor: "background",
        color: "muted",
        fontWeight: "normal",
      },
      // An unfocused container's open tab, or a bar in the `focus parent`
      // selection.
      selected: {
        backgroundColor: "card",
        color: "foreground",
        fontWeight: "medium",
      },
    },
    // Read only by `compoundVariants`.
    tab: {
      false: {},
      true: {},
    },
  },
});

/**
 * Rounds only the top corners. The contents round the bottom ones (see
 * `bottomCornerStyles`); a radius here would notch the seam.
 */
const topCornerStyles = css({
  borderStartEndRadius: "lg",
  borderStartStartRadius: "lg",
});

// No gap: each button is already padded, and together they read as a group.
const controlStyles = hstack({ gap: 0 });

const titleStyles = css({
  // The config's `fonts.size = 11.0`, which has no scale token.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
