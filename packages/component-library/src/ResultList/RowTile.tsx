import type { Icon } from "@phosphor-icons/react";

import { css, cva } from "../../styled-system/css";

/** The glyph's size in its tile. */
const ICON_SIZE = 16;

type Props = {
  icon: Icon;
  /**
   * A picture shown in place of the glyph, cropped to fill the tile, such as
   * a copied image's thumbnail. A URL the page can load, such as a `data:`
   * URL.
   */
  picture?: string | undefined;
};

/**
 * A row's glyph in a framed tile, at the start of a {@link ResultList} row.
 * The tile aligns every row's text and lights with the row.
 *
 * Draws the outline and fill weights and shows one, since CSS can't change a
 * Phosphor glyph's weight. Same approach as `_control/PrefixIconStack`.
 */
export const RowTile = ({ icon: Glyph, picture }: Props) => (
  <span aria-hidden className={tileStyles} data-row-tile="">
    {picture === undefined ? (
      <>
        <span className={glyphStyles({ weight: "regular" })}>
          <Glyph size={ICON_SIZE} />
        </span>
        <span className={glyphStyles({ weight: "fill" })}>
          <Glyph size={ICON_SIZE} weight="fill" />
        </span>
      </>
    ) : (
      // Decorative: the row's text names what it shows.
      <img alt="" className={pictureStyles} src={picture} />
    )}
  </span>
);

const tileStyles = css({
  // Lit with a filled glyph on the highlighted row, since an outline glyph
  // loses contrast on the lighter background.
  "[data-highlighted] > &": {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
    borderColor: "color-mix(in oklab, {colors.foreground} 20%, transparent)",
    color: "foreground",
  },
  blockSize: 7,
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "sm",
  color: "muted",
  display: "grid",
  flexShrink: 0,
  inlineSize: 7,
  // Clips a picture to the rounded corners.
  overflow: "hidden",
  placeItems: "center",
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
});

const pictureStyles = css({
  blockSize: "full",
  inlineSize: "full",
  objectFit: "cover",
});

// Both weights share one grid cell, so swapping doesn't shift layout.
const glyphStyles = cva({
  base: {
    display: "inline-flex",
    gridArea: "1 / 1",
    transition: "opacity {durations.fast} {easings.out}",
  },
  variants: {
    weight: {
      fill: {
        "[data-highlighted] > [data-row-tile] > &": { opacity: 1 },
        opacity: 0,
      },
      regular: {
        "[data-highlighted] > [data-row-tile] > &": { opacity: 0 },
      },
    },
  },
});
