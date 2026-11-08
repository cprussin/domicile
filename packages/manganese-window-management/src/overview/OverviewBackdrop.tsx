import { Fragment } from "react";

import { css, cva } from "../../styled-system/css";
import type { Rect } from "../rect";
import { within } from "../rect";
import { placedAt, placedIn } from "../window-styles";
import type { ScreenOverview } from "./overview";
import { LABEL } from "./tiles";

type Props = {
  /** Whether the overview is closing, which fades the backdrop out. */
  closing: boolean;
  /** Called once the closing fade has played out. */
  onClosed: () => void;
  overviews: readonly ScreenOverview[];
};

/**
 * Under the windows: each screen dimmed, a card for every workspace the
 * overview shows its windows on, and the workspace's name under it.
 *
 * At the wallpaper's depth, after it in the document, so it covers the
 * wallpaper and nothing else. The bars stay over it.
 */
export const OverviewBackdrop = ({ closing, onClosed, overviews }: Props) => (
  <>
    {overviews.map(({ screen, tiles }) => (
      <div
        aria-hidden
        className={backdropStyles({ closing })}
        data-overview-backdrop=""
        key={screen.geometry.name}
        onAnimationEnd={() => {
          if (closing) {
            onClosed();
          }
        }}
        style={placedAt(screen.geometry.screen, BACKDROP)}
      >
        {tiles.map(({ box, name }) => (
          <Fragment key={name}>
            <div
              className={cardStyles}
              style={placedIn(within(box, screen.geometry.screen))}
            />
            <span
              className={labelStyles({ current: name === screen.current })}
              style={placedIn(labelOf(within(box, screen.geometry.screen)))}
            >
              {name}
            </span>
          </Fragment>
        ))}
      </div>
    ))}
  </>
);

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

// The empty desk behind a workspace's windows: lighter than the dimmed photo,
// so an empty workspace still shows its shape.
const cardStyles = css({
  backgroundColor: "fillOverPhoto",
  borderRadius: "md",
});

const labelStyles = cva({
  base: {
    alignItems: "center",
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
