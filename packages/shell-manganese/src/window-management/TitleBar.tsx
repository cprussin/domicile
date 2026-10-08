import { Button } from "@domicile-desktop/component-library/Button";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitHorizontal";
import { SquareSplitVerticalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitVertical";
import { TabsIcon } from "@phosphor-icons/react/dist/ssr/Tabs";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cva, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TitleFocus } from "./title-focus";
import type { TabLayout } from "./tree/frames";
import { Layout } from "./tree/node";
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

/** What a tab's group mark calls each layout. */
const GROUP_NAMES: Record<Layout, string> = {
  [Layout.SplitH]: "Row",
  [Layout.SplitV]: "Column",
  [Layout.Stacking]: "Stack",
  [Layout.Tabbed]: "Tabs",
};

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
   * For a tab standing for a nested container, that container's layout and
   * how many windows it holds.
   */
  group?: { layout: Layout; windows: number } | undefined;
  /**
   * Whether the tab group this tab is in is inside the `focus parent`
   * selection. Lights the tab strip rather than the tabs, which keep showing
   * where the keyboard is.
   */
  groupSelected?: boolean;
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
 *
 * A tab is drawn inset in its slot of the tab strip. The slots meet, so a
 * container's tabs rest in one strip, even a container of one.
 */
export const TitleBar = ({
  besideOpenTab = false,
  depth,
  dragging,
  focus,
  frame,
  fullscreen,
  group,
  groupSelected = false,
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
      slotStyles({
        besideOpenTab,
        groupSelected,
        tab: tabbed !== undefined,
      }),
      movingStyles({ motion }),
      isLeaving(motion) && clickThroughStyles,
      settlingStyles({ dragging }),
    )}
    // Exposed as attributes so devtools and tests can read the state.
    data-focus={focus}
    data-group-selected={groupSelected || undefined}
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
    <div
      className={cx(
        barStyles({
          besideOpenTab,
          focus,
          tab: tabbed !== undefined,
        }),
        !fullscreen && edgeStyles,
        !fullscreen && topCornerStyles,
        settlingStyles({ dragging }),
      )}
      data-face
    >
      {group !== undefined && (
        <GroupMark layout={group.layout} windows={group.windows} />
      )}
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
  </div>
);

/**
 * The layout of the group a tab stands for, and its size, so a group in a tab
 * reads as a group rather than as the window it is named after.
 */
const GroupMark = ({
  layout,
  windows,
}: {
  layout: Layout;
  windows: number;
}) => (
  <span
    aria-label={`${GROUP_NAMES[layout]} of ${windows.toString()}`}
    className={groupMarkStyles}
    role="img"
  >
    <GroupIcon layout={layout} />
    {windows}
  </span>
);

const GroupIcon = ({ layout }: { layout: Layout }) => {
  switch (layout) {
    case Layout.SplitH: {
      return <SquareSplitHorizontalIcon size={14} />;
    }
    case Layout.SplitV: {
      return <SquareSplitVerticalIcon size={14} />;
    }
    case Layout.Stacking: {
      return <RowsIcon size={14} />;
    }
    case Layout.Tabbed: {
      return <TabsIcon size={14} />;
    }
  }
};

/**
 * The bar's slot. For a tab, its piece of the tab strip, with the tab inset
 * so the strip shows around and between the tabs.
 */
const slotStyles = cva({
  base: { display: "flex" },
  compoundVariants: [
    {
      css: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 45%, {colors.background})",
      },
      groupSelected: true,
      tab: true,
    },
  ],
  variants: {
    // Continues the shown window's top edge under the gaps between tabs.
    besideOpenTab: {
      false: { borderBlockEndColor: "transparent" },
      true: { borderBlockEndColor: "borderStrong" },
    },
    // Read only by `compoundVariants`.
    groupSelected: {
      false: {},
      true: {},
    },
    tab: {
      false: {},
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.border} 50%, {colors.background})",
        borderBlockEndStyle: "solid",
        borderBlockEndWidth: "1px",
        paddingBlockStart: 0.75,
        paddingInline: 0.75,
      },
    },
  },
});

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
    flex: 1,
    gap: 1.5,
    justify: "space-between",
    minInlineSize: 0,
    overflow: "hidden",
    // Just enough for the title to clear the rounded corner.
    paddingInlineEnd: 0.5,
    paddingInlineStart: 2,
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
    // Over the slot's bottom line, so the open tab meets its window and a
    // hidden tab's line meets the strip's.
    tab: {
      false: {},
      true: { marginBlockEnd: "-1px" },
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

const groupMarkStyles = hstack({
  color: "muted",
  flexShrink: 0,
  // The config's `fonts.size = 11.0`, as for the title.
  fontSize: "0.6875rem",
  gap: 0.5,
});

const titleStyles = css({
  flex: 1,
  // The config's `fonts.size = 11.0`, which has no scale token.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
