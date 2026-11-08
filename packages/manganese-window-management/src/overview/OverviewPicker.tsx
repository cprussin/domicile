import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { css, cva } from "../../styled-system/css";
import type { Spot } from "../pointer-warp";
import type { Rect } from "../rect";
import { within } from "../rect";
import { placedAt, placedIn } from "../window-styles";
import type { OverviewWindow, ScreenOverview } from "./overview";
import { windowAt } from "./overview";
import { tileAt } from "./tiles";

type Props = {
  /** The screen with the keyboard, whose shown workspace takes focus. */
  focused: string;
  /** Escape, or a press between the tiles. */
  onDismiss: () => void;
  /** A window dropped on another workspace's tile. */
  onMove: (id: string, workspace: string) => void;
  /** A workspace pressed, or chosen from the keyboard. */
  onPick: (workspace: string) => void;
  /** A window pressed. */
  onPickWindow: (id: string) => void;
  overviews: readonly ScreenOverview[];
};

/**
 * Over every window: what the pointer and keyboard act on in the overview.
 *
 * Each screen's workspace area is one layer, with a button over every tile.
 * A press on a window goes to it; anywhere else in a tile goes to its
 * workspace. Dragging a window onto another tile moves it there. The arrow
 * keys move between tiles, and Enter picks one.
 *
 * Windows ignore the pointer underneath: the layer covers them.
 */
export const OverviewPicker = (props: Props) => (
  <>
    {props.overviews.map((overview) => (
      <ScreenPicker
        key={overview.screen.geometry.name}
        overview={overview}
        {...props}
      />
    ))}
  </>
);

/** How far, in page pixels, a press moves before it is a drag. */
const DRAG_SLOP = 6;

/** Over every window, under the lock screen and the desktop's panels. */
const PICKER = 4000;

/** A window being dragged: where it was pressed, and where it is now. */
type Drag = OverviewWindow & { from: Spot; pointerId: number; to: Spot };

const ScreenPicker = ({
  focused,
  onDismiss,
  onMove,
  onPick,
  onPickWindow,
  overview,
}: Props & { overview: ScreenOverview }) => {
  const { geometry, current } = overview.screen;
  const area = geometry.workspace;
  const [pressed, setPressed] = useState<Drag | undefined>();
  const [dragging, setDragging] = useState(false);
  // The click a drag ends with picks nothing.
  const dragged = useRef(false);
  // The click a press on a tile ends with dismisses nothing, wherever it is
  // let go.
  const onTile = useRef(false);
  const shown = useRef<HTMLButtonElement>(null);
  const takesFocus = geometry.name === focused;

  useEffect(() => {
    if (takesFocus) {
      shown.current?.focus();
    }
  }, [takesFocus]);

  /** Whether `event` is another pointer than the one pressing a window. */
  const other = (event: PointerEvent<HTMLElement>) =>
    pressed !== undefined && event.pointerId !== pressed.pointerId;

  const forget = () => {
    setPressed(undefined);
    setDragging(false);
  };

  const pressedOn = (event: PointerEvent<HTMLElement>) => {
    if (!other(event)) {
      const at: Spot = [event.clientX, event.clientY];
      // Only the main button drags; a drag's click may never come.
      const hit = event.button === 0 ? windowAt(overview, at) : undefined;
      dragged.current = false;
      onTile.current = event.target !== event.currentTarget;
      setPressed(
        hit === undefined
          ? undefined
          : { ...hit, from: at, pointerId: event.pointerId, to: at },
      );
      setDragging(false);
    }
  };

  const movedTo = (event: PointerEvent<HTMLElement>) => {
    if (pressed !== undefined && !other(event)) {
      if ((event.buttons & 1) === 0) {
        // Let go off this screen's picker before it took the pointer.
        forget();
      } else {
        const to: Spot = [event.clientX, event.clientY];
        setPressed({ ...pressed, to });
        if (distance(pressed.from, to) > DRAG_SLOP) {
          // Keeps the release wherever it lands; see `lost`. Not from the
          // press, which would send a plain click to the layer, not the tile.
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }
      }
    }
  };

  const released = (event: PointerEvent<HTMLElement>) => {
    if (!other(event)) {
      if (pressed !== undefined && dragging) {
        dragged.current = true;
        const target = tileAt(overview.tiles, [event.clientX, event.clientY]);
        if (target !== undefined && target.name !== pressed.workspace) {
          onMove(pressed.id, target.name);
        }
      }
      forget();
    }
  };

  // Released off this screen's picker: nothing moves. Not when a tile, which
  // a touch starts captured by, hands the pointer to the layer.
  const lost = (event: PointerEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && !other(event)) {
      forget();
    }
  };

  // Taken away, as by the shell for a gesture of its own.
  const canceled = (event: PointerEvent<HTMLElement>) => {
    if (!other(event)) {
      forget();
    }
  };

  const keyed = (event: KeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case "Escape": {
        onDismiss();
        break;
      }
      case "Tab": {
        // The bar and the other screens are behind it.
        stepFocus(event.currentTarget, event.shiftKey ? -1 : 1);
        event.preventDefault();
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        stepFocus(event.currentTarget, -1);
        event.preventDefault();
        break;
      }
      case "ArrowRight":
      case "ArrowDown": {
        stepFocus(event.currentTarget, 1);
        event.preventDefault();
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the keys move focus between the tile buttons, a drag between them moves a window, and a click outside them dismisses; Escape does too
    <div
      aria-label="Workspaces"
      className={pickerStyles}
      data-overview-picker=""
      onClick={(event) => {
        if (dragged.current) {
          dragged.current = false;
        } else if (event.target === event.currentTarget && !onTile.current) {
          onDismiss();
        }
      }}
      onKeyDown={keyed}
      onLostPointerCapture={lost}
      onPointerCancel={canceled}
      onPointerDown={pressedOn}
      onPointerMove={movedTo}
      onPointerUp={released}
      role="dialog"
      style={placedAt(area, PICKER)}
    >
      {overview.tiles.map(({ box, name }) => (
        <button
          aria-current={name === current ? "true" : undefined}
          aria-label={`Workspace ${name}`}
          className={tileStyles({
            aimed:
              dragging &&
              pressed !== undefined &&
              name !== pressed.workspace &&
              tileAt([{ box, name }], pressed.to) !== undefined,
          })}
          key={name}
          onClick={(event) => {
            // From the keyboard, which no drag swallows: a touch drag ends
            // with no click to clear `dragged`.
            const hit =
              event.detail === 0
                ? undefined
                : windowAt(overview, [event.clientX, event.clientY]);
            if (event.detail !== 0 && dragged.current) {
              dragged.current = false;
            } else if (hit === undefined) {
              onPick(name);
            } else {
              onPickWindow(hit.id);
            }
          }}
          ref={name === current ? shown : undefined}
          style={placedIn(within(box, area))}
          type="button"
        />
      ))}
      {pressed !== undefined && dragging && (
        <div
          aria-hidden
          className={ghostStyles}
          style={placedIn(within(carried(pressed), area))}
        />
      )}
    </div>
  );
};

/** Moves keyboard focus `by` tiles along `layer`'s, wrapping around. */
const stepFocus = (layer: HTMLElement, by: number) => {
  const tiles = [...layer.querySelectorAll("button")];
  const focused = layer.querySelector<HTMLButtonElement>("button:focus");
  const at = focused === null ? -1 : tiles.indexOf(focused);
  tiles[(at + by + tiles.length) % tiles.length]?.focus();
};

/** The dragged window's box, carried with the pointer. */
const carried = ({ box, from, to }: Drag): Rect => ({
  ...box,
  x: box.x + to[0] - from[0],
  y: box.y + to[1] - from[1],
});

const distance = ([fromX, fromY]: Spot, [toX, toY]: Spot): number =>
  Math.hypot(toX - fromX, toY - fromY);

// A finger drags windows rather than scrolling or zooming the page.
const pickerStyles = css({ outline: "none", touchAction: "none" });

// Rings drawn outside the tile, so they never cover its windows: the accent
// for the workspace on screen, white under the pointer or keyboard.
const tileStyles = cva({
  base: {
    _focusVisible: { outlineColor: "onPhoto" },
    _hover: { outlineColor: "onPhoto" },
    "&[aria-current]": { outlineColor: "accent" },
    backgroundColor: "transparent",
    borderRadius: "md",
    borderStyle: "none",
    cursor: "pointer",
    outlineColor: "transparent",
    outlineOffset: "3px",
    outlineStyle: "solid",
    outlineWidth: "2px",
    padding: 0,
    transition: "outline-color {durations.fast} {easings.out}",
  },
  variants: {
    aimed: { false: {}, true: { outlineColor: "onPhoto" } },
  },
});

// The dragged window, as an outline that follows the pointer.
const ghostStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
  borderColor: "accent",
  borderRadius: "sm",
  borderStyle: "solid",
  borderWidth: "2px",
  pointerEvents: "none",
});
