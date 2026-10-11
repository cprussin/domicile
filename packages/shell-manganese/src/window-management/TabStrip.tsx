import { Button } from "@domicile-desktop/component-library/Button";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { useRef } from "react";

import { cva, cx } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import type { Float } from "./floating/float";
import type { Rect } from "./rect";
import { within } from "./rect";
import type { Restack } from "./restacking";
import { StripButtons } from "./StripButtons";
import { StripEnd } from "./StripEnd";
import type { Aim, DropTargets } from "./tiled/aim";
import type { StripGroup } from "./tree/frames";
import { useLowered } from "./useLowered";
import type { Settler } from "./useSettling";
import { useSettling } from "./useSettling";
import type { WindowMotion } from "./window-motion";
import { barMotion, isLeaving, isMoving } from "./window-motion";
import {
  clickThroughStyles,
  movingStyles,
  originOf,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

type Props = {
  /** The whole strip's box. See `StripPlace.box`. */
  box: Rect;
  /** The depth of its group, under the group's tabs by document order. */
  depth: number;
  /** Whether its group is being dragged, so the strip follows the pointer. */
  dragging: boolean;
  /** The strip's empty end, or `undefined` for a stack. */
  end: Rect | undefined;
  /** The float holding the group, or `undefined` while it is tiled. */
  float: Float | undefined;
  /**
   * The open window's whole box, which the strip turns about with it. See
   * `scaledAbout`.
   */
  frame: Rect;
  /** Whether the group fills the screen. */
  fullscreen: boolean;
  group: StripGroup;
  /** The motion of the group's open window, which the strip plays too. */
  motion: WindowMotion;
  /** Where the group would land if dropped now. See `StripEnd`. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  /** The group dropped where it was aimed. See `StripEnd`. */
  onDropOn: (aim: Aim) => void;
  /** Floats or tiles the whole group. */
  onFloat: () => void;
  /** Fills the screen with the whole group, or gives it back. */
  onFullscreen: () => void;
  /** The group taken hold of by the strip's end. */
  onGrab: () => void;
  /** A floating group's new top-left corner. */
  onMove: (x: number, y: number) => void;
  /** Opens a tab past the last one. */
  onNewTab: () => void;
  /** The open window's restack animation, which the strip plays too. */
  restack?: Restack | undefined;
  /** Whether the group is in the `focus parent` selection, which lights it. */
  selected: boolean;
  /** Eases the strip into a new box; see `useSettling`. */
  settler?: Settler | undefined;
  /** What a tiled group can be dropped on, on every screen. */
  targets: DropTargets;
};

/**
 * The tab strip of a tabbed or stacking group: one box behind every tab in
 * it, with the strip's edges, and its end's new-tab button, group buttons and
 * drag handle.
 *
 * Its tabs are drawn over it, each by its own window (see `TitleBar`), so a
 * tab keeps its element when it moves to another strip. The strip is drawn by
 * the group's open window, and moves and settles with it. A tab switch hands
 * it to the next open window, which takes over where it is drawn (see
 * `useSettling`).
 */
export const TabStrip = ({
  box,
  depth,
  dragging,
  end,
  float,
  frame,
  fullscreen,
  group,
  motion,
  onAim,
  onDrop,
  onDropOn,
  onFloat,
  onFullscreen,
  onGrab,
  onMove,
  onNewTab,
  restack,
  selected,
  settler,
  targets,
}: Props) => {
  const element = useRef<HTMLDivElement>(null);
  const origin = originOf(frame, box);
  const leaving = isLeaving(motion);
  const playing = stripMotion(motion);
  const lowered = useLowered(depth);
  useSettling({
    element,
    origin,
    rect: box,
    settler,
    shared: group.windows.map(stripKeyOf),
    still: dragging || isMoving(playing),
  });
  return (
    <div
      className={cx(
        stripStyles({ selected }),
        movingStyles({ motion: playing }),
        leaving && clickThroughStyles,
        settlingStyles({ lowered }),
      )}
      data-motion={motion}
      data-strip
      // A leaving group's buttons would do nothing.
      inert={leaving}
      ref={element}
      style={{
        ...placedAt(box, depth),
        ...scaledAbout(frame, box),
        ...shuffledBy(restack),
      }}
    >
      {end !== undefined && (
        <>
          <StripEnd
            float={float}
            fullscreen={fullscreen}
            group={group}
            onAim={onAim}
            onDrop={onDrop}
            onDropOn={onDropOn}
            onGrab={onGrab}
            onMove={onMove}
            rect={within(end, box)}
            targets={targets}
          />
          <NewTab at={within(end, box)} onNewTab={onNewTab} settler={settler} />
          <StripButtons
            floating={float !== undefined}
            fullscreen={fullscreen}
            onFloat={onFloat}
            onFullscreen={onFullscreen}
            rect={within(end, box)}
          />
        </>
      )}
    </div>
  );
};

/**
 * The motion the strip plays for its open window's `motion`. A new tab opens
 * out on the strip, and a tab switch only fades the windows; the strip stays.
 */
const stripMotion = (motion: WindowMotion): WindowMotion =>
  motion === "opening-tab" ? "resting" : barMotion(motion);

/**
 * The key a strip shares with every window in it, so the strip drawn by a
 * newly open tab takes over from the one before.
 */
const stripKeyOf = (window: string): string => `strip:${window}`;

/**
 * The new-tab button at the start of the strip's end, `at`. It eases along the
 * strip as tabs open and close before it, as the tabs do.
 */
const NewTab = ({
  at,
  onNewTab,
  settler,
}: {
  at: Rect;
  onNewTab: () => void;
  settler: Settler | undefined;
}) => {
  const element = useRef<HTMLSpanElement>(null);
  // A point: the button keeps its size.
  const point = { height: 1, width: 1, x: at.x, y: at.y };
  useSettling({ element, origin: CORNER, rect: point, settler, still: false });
  return (
    // A press here must not drag the group.
    <span
      className={newTabStyles}
      data-new-tab
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      ref={element}
      style={{ insetInlineStart: `${at.x.toString()}px` }}
    >
      <Button label="New tab" onClick={onNewTab} size="xs" variant="ghost">
        <PlusIcon size={12} />
      </Button>
    </span>
  );
};

const CORNER = { x: 0, y: 0 };

/**
 * The strip: a rounded top, an edge all round, and a bottom edge that is the
 * window's top edge. The window's top row is tucked under the strip's bottom
 * row (see `SURFACE_TUCK`), and the open tab covers that row to join its
 * window.
 */
const stripStyles = cva({
  base: {
    // Longhands, as for `edgeStyles`.
    borderBlockEndWidth: "1px",
    borderBlockStartWidth: "1px",
    borderColor: "var(--strip-edge)",
    borderInlineWidth: "1px",
    borderStartEndRadius: "lg",
    borderStartStartRadius: "lg",
    borderStyle: "solid",
  },
  variants: {
    // A selected group lights its strip. Its tabs keep their own states.
    selected: {
      false: {
        "--strip-edge": "{colors.borderStrong}",
        backgroundColor:
          "color-mix(in oklab, {colors.card} 45%, {colors.background})",
      },
      true: {
        "--strip-edge":
          "color-mix(in oklab, {colors.accent} 70%, {colors.background})",
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 30%, {colors.background})",
      },
    },
  },
});

/** Level with the tabs, which sit below the strip's top inset. */
const newTabStyles = flex({
  insetBlockEnd: "1px",
  insetBlockStart: 1,
  paddingInlineStart: 0.5,
  pointerEvents: "auto",
  position: "absolute",
});
