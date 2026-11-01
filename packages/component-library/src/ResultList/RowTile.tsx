import type { Icon } from "@phosphor-icons/react";

import { css, cva } from "../../styled-system/css";
import "../stylesheet";

/** The glyph's size in its tile. */
const ICON_SIZE = 16;

type Props = {
  icon: Icon;
};

/**
 * A row's glyph in a framed tile, at the start of a {@link ResultList} row.
 * The tile aligns every row's text and lights with the row.
 *
 * Draws the outline and fill weights and shows one, since CSS can't change a
 * Phosphor glyph's weight. Same approach as `_control/PrefixIconStack`.
 */
export const RowTile = ({ icon: Glyph }: Props) => (
  <span aria-hidden className={tileStyles} data-row-tile="">
    <span className={glyphStyles({ weight: "regular" })}>
      <Glyph size={ICON_SIZE} />
    </span>
    <span className={glyphStyles({ weight: "fill" })}>
      <Glyph size={ICON_SIZE} weight="fill" />
    </span>
  </span>
);

type LogoProps = {
  /** Called when `picture` fails to load. */
  onError?: (() => void) | undefined;
  /** A URL the page can load, such as a `data:` URL. */
  picture: string;
};

/**
 * A logo, such as an application's icon, in a {@link RowTile}'s place. No
 * frame, since logos have their own shape.
 */
export const LogoTile = ({ onError, picture }: LogoProps) => (
  <span aria-hidden className={logoTileStyles}>
    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the picture failing to load, not something a person does to it */}
    <img alt="" className={logoStyles} onError={onError} src={picture} />
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
  placeItems: "center",
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
});

const logoTileStyles = css({
  blockSize: 7,
  display: "grid",
  flexShrink: 0,
  inlineSize: 7,
  placeItems: "center",
});

// Slightly larger than a glyph, since it has no frame.
const logoStyles = css({
  blockSize: 5,
  inlineSize: 5,
  objectFit: "contain",
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
