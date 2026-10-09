import { Button } from "@domicile-desktop/component-library/Button";
import { BrowsersIcon } from "@phosphor-icons/react/dist/ssr/Browsers";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitHorizontal";
import { SquareSplitVerticalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitVertical";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { TabsIcon } from "@phosphor-icons/react/dist/ssr/Tabs";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { PointerEvent as ReactPointerEvent } from "react";

import { css, cva, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TitleFocus } from "./title-focus";
import type { StripPlace, TabLayout } from "./tree/frames";
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
  /** Whether the window floats. Switches the float button to "Tile". */
  floating: boolean;
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
  /** Toggles floating, like `floating toggle`. */
  onFloat: () => void;
  /** Toggles fullscreen, like `mod+f`. */
  onFullscreen: () => void;
  /** Called when `motion` finishes. */
  onMotionEnded: () => void;
  onContextMenu?: ((event: { preventDefault: () => void }) => void) | undefined;
  /** A middle click, which closes the window as a browser closes a tab. */
  onMiddleClick?: (() => void) | undefined;
  /** A press on the bar, which starts a drag or selects a tab's window. */
  onPointerDown?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  rect: Rect;
  /**
   * The restack animation while the window trades places with another float.
   * See `shuffledBy`.
   */
  restack?: Restack | undefined;
  /** Its place in its tab strip, or `undefined` for a window's own bar. */
  strip?: StripPlace | undefined;
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
 * A tab is drawn in its slot of the tab strip. The slots meet, and the last
 * one runs the strip on to its end, so a container's tabs rest in one strip,
 * even a container of one. The strip's bottom edge is the window's top edge;
 * the open tab breaks it to join its window.
 */
export const TitleBar = ({
  depth,
  dragging,
  floating,
  focus,
  frame,
  fullscreen,
  group,
  groupSelected = false,
  motion,
  onClose,
  onContextMenu,
  onFloat,
  onFullscreen,
  onMiddleClick,
  onMotionEnded,
  onPointerDown,
  rect,
  restack,
  strip,
  tabbed,
  title,
  window,
}: Props) => {
  const hidden = strip !== undefined && !strip.open;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a press only raises the window; its buttons are the keyboard-reachable controls
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above
    <div
      className={cx(
        slotStyles,
        strip !== undefined &&
          stripStyles({
            first: strip.first,
            selected: groupSelected,
            stacked: tabbed === Layout.Stacking,
          }),
        movingStyles({ motion }),
        isLeaving(motion) && clickThroughStyles,
        settlingStyles({ dragging }),
      )}
      data-divided={strip?.divided || undefined}
      // Exposed as attributes so devtools and tests can read the state.
      data-focus={focus}
      data-group-selected={groupSelected || undefined}
      data-motion={motion}
      data-strip-end={strip?.rest === undefined ? undefined : true}
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
        ...stripRestOf(strip),
      }}
    >
      <div
        className={cx(
          strip === undefined
            ? cx(
                barStyles({ focus }),
                !fullscreen && edgeStyles,
                !fullscreen && topCornerStyles,
              )
            : tabStyles({ focus, open: !hidden }),
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
          {/*
            A hidden tab only offers to close, as in a browser, so its title
            keeps the room. A narrow bar drops these too.
          */}
          {!hidden && (
            <span className={extraControlStyles}>
              <Button
                label={floating ? "Tile" : "Float"}
                onClick={onFloat}
                size="sm"
                variant="ghost"
              >
                {floating ? (
                  <SquaresFourIcon size={14} />
                ) : (
                  <BrowsersIcon size={14} />
                )}
              </Button>
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
            </span>
          )}
          <Button label="Close" onClick={onClose} size="sm" variant="ghost">
            <XIcon size={14} />
          </Button>
        </span>
      </div>
    </div>
  );
};

/**
 * Inline custom property for {@link stripStyles}: how far the last tab's slot
 * runs the strip on past itself. None for other bars.
 */
const stripRestOf = (
  strip: StripPlace | undefined,
): Record<`--${string}`, string> =>
  strip?.rest === undefined
    ? {}
    : { "--strip-rest": `${strip.rest.toString()}px` };

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

// Fills the slot with the bar's own box.
const slotStyles = css({ display: "flex" });

/**
 * A tab's slot: its piece of the tab strip. The strip has a rounded top, an
 * edge all round, and a bottom edge that is the window's top edge. The last
 * slot draws the rest of the strip past itself, at `--strip-rest`, and passes
 * the pointer through it. A divided slot draws a divider before its tab.
 */
const stripStyles = cva({
  base: {
    // A short line in the gap before the tab, between two hidden tabs.
    "&[data-divided]::before": {
      backgroundColor: "borderStrong",
      content: '""',
      inlineSize: "1px",
      // Centered on the tab's title, which sits below the strip's top inset.
      insetBlockEnd: 1.5,
      insetBlockStart: 2.5,
      insetInlineStart: 0.5,
      position: "absolute",
    },
    "&[data-strip-end]::after": {
      backgroundColor: "inherit",
      borderBlockWidth: "1px",
      borderColor: "inherit",
      borderInlineEndWidth: "1px",
      borderStartEndRadius: "lg",
      borderStyle: "solid",
      content: '""',
      inlineSize: "var(--strip-rest)",
      insetBlockEnd: "-1px",
      insetBlockStart: "-1px",
      insetInlineStart: "100%",
      pointerEvents: "none",
      position: "absolute",
    },
    borderBlockEndWidth: "1px",
    borderStyle: "solid",
    paddingBlockStart: 1,
    paddingInlineStart: 1,
  },
  compoundVariants: [
    {
      css: { borderBlockStartWidth: "1px", borderStartEndRadius: "lg" },
      first: true,
      stacked: true,
    },
  ],
  variants: {
    first: {
      false: {},
      true: { borderInlineStartWidth: "1px", borderStartStartRadius: "lg" },
    },
    // A selected group lights its strip. Its tabs keep their own states.
    selected: {
      false: {
        backgroundColor:
          "color-mix(in oklab, {colors.card} 45%, {colors.background})",
        borderColor: "borderStrong",
      },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 30%, {colors.background})",
        borderColor:
          "color-mix(in oklab, {colors.accent} 70%, {colors.background})",
      },
    },
    // A stack's bars each span the strip. Each bar's bottom edge is the top
    // edge of the next, so only the first draws one.
    stacked: {
      false: { borderBlockStartWidth: "1px" },
      true: { borderInlineWidth: "1px", paddingInlineEnd: 1 },
    },
  },
});

/**
 * A tab, in its slot of the strip. The open tab is raised in the card with an
 * edge, and reaches over the strip's bottom edge to join its window. Hidden
 * tabs lie flat on the strip.
 */
const tabStyles = cva({
  base: hstack.raw({
    borderBlockEndWidth: 0,
    borderBlockStartWidth: "1px",
    borderInlineWidth: "1px",
    borderStartEndRadius: "md",
    borderStartStartRadius: "md",
    borderStyle: "solid",
    containerType: "inline-size",
    flex: 1,
    gap: 1.5,
    justify: "space-between",
    minInlineSize: 0,
    overflow: "hidden",
    paddingInlineEnd: 0.5,
    paddingInlineStart: 2,
  }),
  // The background follows both variants, so each pair sets it once.
  compoundVariants: [
    {
      css: { backgroundColor: "card" },
      focus: ["focused", "leaf", "resting", "selected"],
      open: true,
    },
    {
      css: {
        _hover: {
          backgroundColor:
            "color-mix(in oklab, {colors.card} 60%, transparent)",
          color: "foreground",
        },
        backgroundColor: "transparent",
      },
      focus: ["focused", "leaf", "resting", "selected"],
      open: false,
    },
  ],
  variants: {
    // Weight as well as color, for users who cannot tell the colors apart.
    focus: {
      focused: { fontWeight: "medium" },
      leaf: { fontWeight: "medium" },
      resting: { fontWeight: "normal" },
      selected: { fontWeight: "normal" },
      // A window that asked for the keyboard (sway's `urgent`), as its bar.
      urgent: {
        backgroundColor:
          "color-mix(in oklab, {colors.warning} 45%, {colors.background})",
        fontWeight: "medium",
      },
    },
    open: {
      false: { borderColor: "transparent", color: "muted" },
      true: {
        borderColor: "borderStrong",
        color: "foreground",
        marginBlockEnd: "-1px",
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
    borderBlockEndColor: "transparent",
    borderBlockEndWidth: "1px",
    containerType: "inline-size",
    flex: 1,
    gap: 1.5,
    justify: "space-between",
    minInlineSize: 0,
    overflow: "hidden",
    // Just enough for the title to clear the rounded corner.
    paddingInlineEnd: 0.5,
    paddingInlineStart: 2,
  }),
  variants: {
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
      // A bar in the `focus parent` selection.
      selected: {
        backgroundColor: "card",
        color: "foreground",
        fontWeight: "medium",
      },
      // A window that asked for the keyboard (sway's `urgent`).
      urgent: {
        backgroundColor:
          "color-mix(in oklab, {colors.warning} 45%, {colors.background})",
        color: "foreground",
        fontWeight: "medium",
      },
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

// Hidden in a bar too narrow to keep its title beside them. The bar is the
// query container (see `barStyles` and `tabStyles`).
const extraControlStyles = hstack({
  "@container (max-width: 10rem)": { display: "none" },
  gap: 0,
});

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
