import type { CSSProperties, TransitionEvent } from "react";
import { useLayoutEffect, useRef } from "react";

import { css, cva } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import type { Rect } from "../rect";
import { within } from "../rect";
import { placedAt, placedIn } from "../window-styles";
import type { ScreenOverview } from "./overview";
import { cameraOf } from "./overview";
import type { OverviewTile, View } from "./tiles";
import { fromOrigin, LABEL, matrixOf, partway, viewOf } from "./tiles";

type Props = {
  /** Whether the overview is closing, which fades the backdrop out. */
  closing: boolean;
  /** Called once the camera is back on the shown workspace as it closes. */
  onClosed: () => void;
  overviews: readonly ScreenOverview[];
  /** Which card each tile shows; see `WindowState.overviewCards`. */
  cards: Readonly<Record<string, string>>;
  /**
   * How far open a pinch has the overview, 0 to 1, while one moves it; see
   * `useOverviewPinch`.
   */
  progress?: number | undefined;
};

/**
 * Under the windows: each screen dimmed, a card for every workspace the
 * overview shows its windows on, and the workspace's name under it.
 *
 * At the wallpaper's depth, after it in the document, so it covers the
 * wallpaper and nothing else. The bars stay over it.
 */
export const OverviewBackdrop = ({
  cards,
  closing,
  onClosed,
  overviews,
  progress,
}: Props) => {
  // Where each card was last drawn: its tile, and the screen it was on.
  const drawn = useRef(new Map<string, { box: Rect; screen: string }>());
  useLayoutEffect(() => {
    drawn.current = new Map(
      overviews.flatMap(({ screen, tiles }) =>
        dealt(tiles, cards).map(({ box, card }) => [
          card,
          { box, screen: screen.geometry.name },
        ]),
      ),
    );
  });
  // A pinch let go with the overview shut leaves nothing to ease, so no
  // transition ends to say it has closed.
  const followed = useRef(progress);
  useLayoutEffect(() => {
    if (closing && followed.current === 0) {
      onClosed();
    }
    followed.current = progress;
  }, [closing, onClosed, progress]);
  return (
    <>
      {overviews.map((overview) => {
        const { screen, tiles } = overview;
        // The camera on the shown workspace, for the grid placed at the
        // screen's corner. See `cameraOf`.
        const camera = fromOrigin(cameraOf(overview), screen.geometry.screen);
        return (
          <div
            aria-hidden
            className={backdropStyles({ closing })}
            data-overview-backdrop=""
            key={screen.geometry.name}
            style={{
              ...placedAt(screen.geometry.screen, BACKDROP),
              ...followedAt(progress),
            }}
          >
            <div
              className={gridStyles}
              data-overview-grid=""
              onTransitionEnd={(event: TransitionEvent) => {
                // Not the end of a card's or name's own transition.
                if (
                  closing &&
                  event.target === event.currentTarget &&
                  event.propertyName === "transform"
                ) {
                  onClosed();
                }
              }}
              style={gridAt(camera, closing, progress)}
            >
              {dealt(tiles, cards).map(({ box, card }) => {
                const was = drawn.current.get(card);
                const from =
                  was === undefined || was.screen === screen.geometry.name
                    ? undefined
                    : was.box;
                return (
                  <div
                    className={cardStyles({ crossing: from !== undefined })}
                    data-overview-card={card}
                    key={card}
                    style={cardAt(screen.geometry.screen, box, from)}
                  />
                );
              })}
              {tiles.map(({ box, name }) => (
                <span
                  className={labelStyles({ current: name === screen.current })}
                  key={name}
                  style={{
                    ...placedIn(labelOf(within(box, screen.geometry.screen))),
                    ...followedAt(progress),
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
};

/**
 * Inline style for the grid, which comes into view from `camera` and, as the
 * overview closes, goes back to it. While a pinch moves the overview, it
 * keeps up, `progress` of the way from `camera`.
 */
const gridAt = (
  camera: View,
  closing: boolean,
  progress: number | undefined,
): Record<`--${string}`, string> & CSSProperties => {
  const from = { "--overview-from": matrixOf(camera) };
  if (progress === undefined) {
    return closing ? { ...from, "--overview-to": matrixOf(camera) } : from;
  } else {
    return {
      ...from,
      "--overview-to": matrixOf(partway(camera, NO_MOVE, progress)),
      transition: "none",
    };
  }
};

/** The grid at rest in the open overview. */
const NO_MOVE: View = { scale: 1, x: 0, y: 0 };

/**
 * Inline style fading the backdrop or a name `progress` of the way in, with
 * no ease, while a pinch moves the overview, or none.
 */
const followedAt = (progress: number | undefined): CSSProperties =>
  progress === undefined ? {} : { opacity: progress, transition: "none" };

/**
 * Each tile's card, and the tile it is on, in the cards' own order: a card
 * moved by a swap keeps its place in the document, which would otherwise
 * restyle it from scratch rather than ease it to its new tile.
 */
const dealt = (
  tiles: readonly OverviewTile[],
  cards: Readonly<Record<string, string>>,
): { box: Rect; card: string }[] =>
  tiles
    .map(({ box, name }) => ({ box, card: cards[name] ?? name }))
    .toSorted((one, other) => one.card.localeCompare(other.card));

/**
 * Inline style drawing a card the size of `screen` through its tile at `box`,
 * as the windows are drawn (see `seenAt`): one matrix it eases, so its size
 * and place move together, as its windows' do. Its corners are scaled up to
 * stay `md` once shrunk. A card just crossed from another screen starts from
 * its tile there, at `from`.
 */
const cardAt = (
  screen: Rect,
  box: Rect,
  from?: Rect,
): Record<`--${string}`, string> & CSSProperties => {
  const seenIn = (tile: Rect) =>
    viewOf({ ...screen, x: 0, y: 0 }, within(tile, screen));
  const view = seenIn(box);
  return {
    ...(from === undefined ? {} : { "--card-from": matrixOf(seenIn(from)) }),
    "--card-at": matrixOf(view),
    blockSize: `${screen.height.toString()}px`,
    borderRadius: `calc(${token.var("radii.md")} / ${view.scale.toString()})`,
    inlineSize: `${screen.width.toString()}px`,
    insetBlockStart: 0,
    insetInlineStart: 0,
    position: "absolute",
  };
};

/** The wallpaper's depth. See `COVERED` in `placement.ts`. */
const BACKDROP = -2;

/** The strip under a tile its name is centered in. */
const labelOf = (tile: Rect): Rect => ({
  height: LABEL,
  width: tile.width,
  x: tile.x,
  y: tile.y + tile.height,
});

// Dims like the scratchpad's backdrop, without the blur: the tiles are the
// point, and blurring the photo would cost a pass over every screen. A
// transition, so closing fades from wherever a pinch left it.
const backdropStyles = cva({
  base: {
    _starting: { opacity: 0 },
    backgroundColor: "backdrop",
    // Its grid moves in from beside the shown workspace, off the screen.
    overflow: "clip",
    pointerEvents: "none",
    transition: "opacity {durations.slower} {easings.out}",
  },
  variants: {
    closing: {
      false: {},
      true: { opacity: 0 },
    },
  },
});

// The cards and names, moved by the same camera as the windows: pulled back
// from the shown workspace as the overview opens, pushed back in as it
// closes. A transition from a starting style on the windows' spring (see
// `seenStyles`), so closing partway through opening turns back.
const gridStyles = css({
  _starting: { transform: "var(--overview-from)" },
  inset: 0,
  position: "absolute",
  transform: "var(--overview-to, none)",
  transformOrigin: "0 0",
  transition: "transform {durations.springs.smooth} {easings.springs.smooth}",
});

// The empty desk behind a workspace's windows: lighter than the dimmed photo,
// so an empty workspace still shows its shape. Swapped, it slides with its
// windows on their spring, as `seenStyles` moves them; swapped onto another
// screen, it is drawn afresh there, sliding in from its old tile past the
// screen's edge.
const cardStyles = cva({
  base: {
    backgroundColor: "fillOverPhoto",
    // Through a property, since `@starting-style` loses to an inline
    // `transform`; see `seenStyles`.
    transform: "var(--card-at)",
    transformOrigin: "0 0",
    transition: "transform {durations.springs.smooth} {easings.springs.smooth}",
  },
  variants: {
    crossing: {
      false: {},
      true: { _starting: { transform: "var(--card-from)" } },
    },
  },
});

const labelStyles = cva({
  base: {
    // Fades in once the grid has all but landed, with the tiles' rings. A
    // transition, so names a pinch faded part of the way in carry on from
    // there.
    _starting: { opacity: 0 },
    alignItems: "center",
    color: "onPhoto",
    display: "flex",
    fontSize: "ui",
    fontVariantNumeric: "tabular-nums",
    fontWeight: "medium",
    justifyContent: "center",
    textShadow: "textOverPhoto",
    transition: "opacity {durations.normal} {easings.out} {durations.slow}",
  },
  variants: {
    current: { false: {}, true: { fontWeight: "semibold" } },
  },
});
