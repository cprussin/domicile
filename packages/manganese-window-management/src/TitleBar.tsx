import { Button } from "@domicile-desktop/component-library/Button";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BrowsersIcon } from "@phosphor-icons/react/dist/ssr/Browsers";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitHorizontal";
import { SquareSplitVerticalIcon } from "@phosphor-icons/react/dist/ssr/SquareSplitVertical";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { TabsIcon } from "@phosphor-icons/react/dist/ssr/Tabs";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactElement, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import { css, cva, cx } from "../styled-system/css";
import { hstack, vstack } from "../styled-system/patterns";
import { grabCursorStyles } from "./grab-cursor-styles";
import { raised } from "./placement";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TitleFocus } from "./title-focus";
import type { StripPlace, TabLayout } from "./tree/frames";
import { Layout } from "./tree/node";
import { GrabCursor } from "./useGrabCursor";
import { useLowered } from "./useLowered";
import type { Settler } from "./useSettling";
import { UPRIGHT, useSettling } from "./useSettling";
import type { WindowMotion } from "./window-motion";
import { isLeaving, isMoving } from "./window-motion";
import {
  clickThroughStyles,
  collapsedAlong,
  edgeStyles,
  movingStyles,
  originAt,
  originOf,
  placedAt,
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
   * The page's description, which a tab's tooltip shows under its title, or
   * `undefined` for none.
   */
  description?: string | undefined;
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
   * Whether the window is inside the `focus parent` selection. A tab gets an
   * accent line along its top, which tells a selected tab group from its
   * focused tab: the glow lights the whole group for both.
   */
  groupSelected?: boolean;
  /**
   * The window's whole box, which bar and contents both scale about. See
   * {@link scaledAbout}. For a tab, this is the tab's own box.
   */
  frame: Rect;
  /**
   * Whether the window hangs from the screen's top edge, as a scratchpad
   * window does, which squares the bar's top corners.
   */
  hanging?: boolean;
  /**
   * The window's icon URL, drawn before its title, or `undefined` for a
   * stand-in.
   */
  icon?: string | undefined;
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
  /** Eases the bar into a new box; see `useSettling`. */
  settler?: Settler | undefined;
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
 * A tab is drawn in its slot of its group's strip, over the strip itself
 * (`TabStrip`), so a tab keeps its element when it moves to another strip.
 * The open tab covers the strip's bottom edge to join its window.
 *
 * It moves as its window's contents do (`useSettling`), so the two keep
 * together.
 */
export const TitleBar = ({
  depth,
  description,
  dragging,
  floating,
  focus,
  frame,
  fullscreen,
  group,
  groupSelected = false,
  hanging = false,
  icon,
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
  settler,
  strip,
  tabbed,
  title,
  window,
}: Props) => {
  const hidden = strip !== undefined && !strip.open;
  const element = useRef<HTMLDivElement>(null);
  // A tab opening or leaving turns about its strip's start, as the tabs after
  // it ease along. Anything else turns about its whole window's middle.
  const origin = alongStrip(motion) ? STRIP_START : originOf(frame, rect);
  // Over the rest of the strip, which slides under it when tabs swap.
  const shownDepth = strip?.open === true ? raised(depth) : depth;
  const lowered = useLowered(shownDepth);
  useSettling({
    element,
    origin,
    rect,
    settler,
    still: dragging || isMoving(motion),
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a press only raises the window; its buttons are the keyboard-reachable controls
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above
    <div
      className={cx(
        slotStyles,
        strip !== undefined &&
          tabSlotStyles({ stacked: tabbed === Layout.Stacking }),
        movingStyles({ motion }),
        isLeaving(motion) && clickThroughStyles,
        settlingStyles({ lowered }),
        // The bar holds pointer capture during a drag, so its cursor shows.
        dragging && grabCursorStyles[GrabCursor.Grabbing],
      )}
      data-divided={strip?.divided || undefined}
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
      // A middle press closes the window, so it does not reach `WindowFrame`:
      // selecting a hidden tab would show it for an instant first.
      onPointerDown={(event) => {
        if (event.button === MIDDLE_BUTTON) {
          event.stopPropagation();
        } else {
          onPointerDown?.(event);
        }
      }}
      ref={element}
      style={{
        ...placedAt(rect, shownDepth),
        ...originAt(origin),
        ...shuffledBy(restack),
        ...collapsedAlong(tabbed),
      }}
    >
      <TabTooltip
        description={description}
        tab={strip !== undefined}
        title={title}
      >
        <div
          className={cx(
            strip === undefined
              ? cx(
                  barStyles({ focus }),
                  !fullscreen && edgeStyles,
                  !fullscreen && !hanging && topCornerStyles,
                )
              : tabStyles({
                  focus,
                  joined: !hidden && tabbed === Layout.Tabbed,
                  marked: groupSelected,
                  nested: strip.nested,
                  open: !hidden,
                }),
            settlingStyles(),
          )}
          data-face
        >
          <span className={leadStyles} {...{ [UPRIGHT]: "" }}>
            {group !== undefined && (
              <GroupMark layout={group.layout} windows={group.windows} />
            )}
            {/* Keyed so a new icon gets another try after one fails to load. */}
            <WindowIcon icon={icon} key={icon} />
            <span className={titleStyles}>{title}</span>
          </span>
          {/*
        A press on a button must not start a drag: drag pointer capture would
        retarget the click to the bar.
      */}
          <span
            className={controlStyles}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            {...{ [UPRIGHT]: "" }}
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
      </TabTooltip>
    </div>
  );
};

/**
 * Shows a tab's whole title and its page's description while the pointer
 * rests on it, since a tab is cut to its slot. A window's own bar spans the
 * window, so it shows `children` alone.
 */
const TabTooltip = ({
  children,
  description,
  tab,
  title,
}: {
  children: ReactElement;
  description: string | undefined;
  tab: boolean;
  title: string;
}) =>
  tab ? (
    <Tooltip
      content={
        <span className={summaryStyles}>
          <span className={summaryTitleStyles}>{title}</span>
          {description !== undefined && (
            <span className={summaryDescriptionStyles}>{description}</span>
          )}
        </span>
      }
      trigger={children}
    />
  ) : (
    children
  );

/** Whether a tab plays `motion` along its strip, opening or leaving it. */
const alongStrip = (motion: WindowMotion): boolean =>
  motion === "closing-tab" ||
  motion === "opening-tab" ||
  motion === "sending-tab";

/** The `transform-origin` of a tab moving along its strip. */
const STRIP_START = { x: 0, y: 0 };

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

/**
 * The window's icon, or a stand-in when it has none or it does not load, so
 * every title starts in the same place.
 */
const WindowIcon = ({ icon }: { icon: string | undefined }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={iconStyles} data-icon>
      {icon === undefined || failed ? (
        <AppWindowIcon size={14} />
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: `onError` is the image failing to load, not an interaction
        <img
          alt=""
          className={iconImageStyles}
          onError={() => {
            setFailed(true);
          }}
          src={icon}
        />
      )}
    </span>
  );
};

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
 * A tab's slot in its strip, inside the strip's edges: its top row is the
 * strip's top edge and its bottom row the window's top edge. A divided slot
 * draws a divider before its tab.
 */
const tabSlotStyles = cva({
  base: {
    paddingBlockEnd: "1px",
    paddingBlockStart: "calc({spacing.1} + 1px)",
    paddingInlineStart: 1,
  },
  variants: {
    stacked: {
      // A short line in the gap before the tab, between two hidden tabs.
      false: {
        "&[data-divided]::before": {
          backgroundColor: "borderStrong",
          content: '""',
          inlineSize: "1px",
          // Centered on the tab's title.
          insetBlockEnd: 1.5,
          insetBlockStart: 2.5,
          insetInlineStart: 0.5,
          position: "absolute",
        },
      },
      // A stack's bars each span the strip, with a line between two.
      true: {
        "&[data-divided]::before": {
          backgroundColor: "borderStrong",
          blockSize: "1px",
          content: '""',
          insetBlockStart: 0,
          insetInlineEnd: 0,
          insetInlineStart: 0,
          position: "absolute",
        },
        paddingInlineEnd: 1,
      },
    },
  },
});

/**
 * A tab, in its slot of the strip. The open tab is raised with an edge, and
 * covers the strip's bottom edge to meet its window. Hidden tabs lie flat on
 * the strip.
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
      // Matches the address bar, which it meets. Brighter than the card, so
      // the open tab stands out from the strip.
      css: {
        backgroundColor:
          "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
      },
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
    // The open tab's edge follows its strip's: stronger on a well. See
    // `TabStrip`.
    {
      css: { borderColor: "borderStrong" },
      nested: false,
      open: true,
    },
    {
      css: {
        borderColor:
          "color-mix(in oklab, {colors.foreground} 40%, {colors.background})",
      },
      nested: true,
      open: true,
    },
  ],
  variants: {
    // Weight as well as color, for users who cannot tell the colors apart.
    focus: {
      focused: { fontWeight: "medium" },
      leaf: { fontWeight: "medium" },
      resting: { fontWeight: "normal" },
      selected: { fontWeight: "normal" },
    },
    // Over the strip's bottom row, which draws the window's top edge. The
    // padding fills that row, so the title stays level with a hidden tab's.
    joined: {
      false: {},
      true: { marginBlockEnd: "-1px", paddingBlockEnd: "1px" },
    },
    // In the `focus parent` selection. A shape as well as a color, and it
    // leaves a hidden tab flat, so it does not look open.
    marked: {
      false: {},
      true: { boxShadow: "inset 0 {spacing.0.5} 0 {colors.accent}" },
    },
    nested: { false: {}, true: {} },
    open: {
      // A press opens a hidden tab.
      false: { borderColor: "transparent", color: "muted", cursor: "pointer" },
      true: {
        color: "foreground",
      },
    },
  },
});

/**
 * Bar colors for sway's three client states plus `leaf`.
 *
 * The glow around the focused window is the main focus indicator (see
 * `FocusGlow`), so the bar only adds the open tab's background and a heavier
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
        backgroundColor:
          "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
        color: "foreground",
        // Weight as well as color, for users who cannot tell the colors
        // apart.
        fontWeight: "medium",
      },
      // The focused window inside a `focus parent` selection. The group's
      // bars use the open tab's background, so this one mixes in the accent.
      leaf: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 45%, color-mix(in oklab, {colors.foreground} 14%, {colors.background}))",
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
        backgroundColor:
          "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
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

/**
 * No gap: each button is already padded, and together they read as a group.
 *
 * Kept upright about the bar's end while it settles, on the bar's own
 * background, so a title laid out wider than a growing bar runs under the
 * buttons.
 */
const controlStyles = hstack({
  backgroundColor: "inherit",
  gap: 0,
  transformOrigin: "right center",
});

/**
 * The bar's group mark, icon and title, kept upright about the bar's start
 * while it settles. `transform-origin` has no logical keywords.
 */
const leadStyles = hstack({
  flex: 1,
  gap: 1.5,
  minInlineSize: 0,
  transformOrigin: "left center",
});

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

// Sized to the title's line, like a browser tab's icon.
const iconStyles = css({
  color: "muted",
  display: "flex",
  flexShrink: 0,
});

const iconImageStyles = css({
  height: "14px",
  objectFit: "contain",
  width: "14px",
});

const titleStyles = css({
  flex: 1,
  // The config's `fonts.size = 11.0`, which has no scale token.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const summaryStyles = vstack({ alignItems: "stretch", gap: 0.5 });

const summaryTitleStyles = css({
  fontWeight: "medium",
  overflowWrap: "anywhere",
});

const summaryDescriptionStyles = css({ color: "muted" });
