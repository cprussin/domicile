import type { CSSProperties } from "react";

import { css, cva } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import type { Rect } from "../rect";
import { within } from "../rect";
import { placedAt, placedIn } from "../window-styles";
import type { ScreenOverview } from "./overview";
import { cameraOf } from "./overview";
import type { OverviewTile } from "./tiles";
import { fromOrigin, LABEL, matrixOf, viewOf } from "./tiles";

type Props = {
  /** Whether the overview is closing, which fades the backdrop out. */
  closing: boolean;
  /** Called once the closing fade has played out. */
  onClosed: () => void;
  overviews: readonly ScreenOverview[];
  /** Which card each tile shows; see `WindowState.overviewCards`. */
  cards: Readonly<Record<string, string>>;
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
}: Props) => (
  <>
    {overviews.map((overview) => {
      const { screen, tiles } = overview;
      // The camera on the shown workspace, for the grid placed at the
      // screen's corner. See `cameraOf`.
      const camera = matrixOf(
        fromOrigin(cameraOf(overview), screen.geometry.screen),
      );
      return (
        <div
          aria-hidden
          className={backdropStyles({ closing })}
          data-overview-backdrop=""
          key={screen.geometry.name}
          onAnimationEnd={(event) => {
            // Not the end of a tile's or name's own animation.
            if (closing && event.target === event.currentTarget) {
              onClosed();
            }
          }}
          style={placedAt(screen.geometry.screen, BACKDROP)}
        >
          <div
            className={gridStyles}
            data-overview-grid=""
            style={gridAt(camera, closing)}
          >
            {dealt(tiles, cards).map(({ box, card }) => (
              <div
                className={cardStyles}
                data-overview-card={card}
                key={card}
                style={cardAt(screen.geometry.screen, box)}
              />
            ))}
            {tiles.map(({ box, name }) => (
              <span
                className={labelStyles({ current: name === screen.current })}
                key={name}
                style={placedIn(labelOf(within(box, screen.geometry.screen)))}
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

/**
 * Inline style for the grid, which comes into view from `camera` and, as the
 * overview closes, goes back to it.
 */
const gridAt = (
  camera: string,
  closing: boolean,
): Record<`--${string}`, string> & CSSProperties => ({
  "--overview-from": camera,
  ...(closing ? { "--overview-to": camera } : {}),
});

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
 * stay `md` once shrunk.
 */
const cardAt = (screen: Rect, box: Rect): CSSProperties => {
  const view = viewOf({ ...screen, x: 0, y: 0 }, within(box, screen));
  return {
    blockSize: `${screen.height.toString()}px`,
    borderRadius: `calc(${token.var("radii.md")} / ${view.scale.toString()})`,
    inlineSize: `${screen.width.toString()}px`,
    insetBlockStart: 0,
    insetInlineStart: 0,
    position: "absolute",
    transform: matrixOf(view),
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
// point, and blurring the photo would cost a pass over every screen. Fades
// out under a second name, since an animation reversed after it played does
// not play again.
const backdropStyles = cva({
  base: {
    animation: "overviewShowing {durations.slower} {easings.out}",
    backgroundColor: "backdrop",
    // Its grid moves in from beside the shown workspace, off the screen.
    overflow: "clip",
    pointerEvents: "none",
  },
  variants: {
    closing: {
      false: {},
      true: {
        animation:
          "overviewHiding {durations.slower} {easings.out} reverse forwards",
      },
    },
  },
});

// The cards and names, moved by the same camera as the windows: pulled back
// from the shown workspace as the overview opens, pushed back in as it
// closes. A transition from a starting style, as the windows' (see
// `seenStyles`), so closing partway through opening turns back.
const gridStyles = css({
  _starting: { transform: "var(--overview-from)" },
  inset: 0,
  position: "absolute",
  transform: "var(--overview-to, none)",
  transformOrigin: "0 0",
  transition: "transform {durations.slower} {easings.emphasized}",
});

// The empty desk behind a workspace's windows: lighter than the dimmed photo,
// so an empty workspace still shows its shape. Swapped, it slides with its
// windows, as `seenStyles` moves them.
const cardStyles = css({
  backgroundColor: "fillOverPhoto",
  transformOrigin: "0 0",
  transition: "transform {durations.slower} {easings.emphasized}",
});

const labelStyles = cva({
  base: {
    alignItems: "center",
    // Once the grid has all but landed, with the tiles' rings.
    animation:
      "overviewShowing {durations.normal} {easings.out} {durations.slow} backwards",
    color: "onPhoto",
    display: "flex",
    fontSize: "ui",
    fontVariantNumeric: "tabular-nums",
    fontWeight: "medium",
    justifyContent: "center",
    textShadow: "textOverPhoto",
  },
  variants: {
    current: { false: {}, true: { fontWeight: "semibold" } },
  },
});
