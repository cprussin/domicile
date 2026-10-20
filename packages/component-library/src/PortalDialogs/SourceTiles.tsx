import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { FrozenDesk, ShotRect } from "@domicile-desktop/sdk/portal";
import type { CSSProperties, ReactNode } from "react";
import { css } from "../../styled-system/css";

/** A source a picker offers, as its tile shows it. */
export type SourceTile = {
  /** Where the source is on the desk's frame, to preview it from. */
  area: ShotRect | undefined;
  /** The source's application icon, or one for its kind. */
  icon: ReactNode;
  /** Unique among the tiles. */
  key: string;
  name: string;
};

type Props = {
  /** The frozen desk to preview the sources on, if there is one. */
  desk: FrozenDesk | undefined;
  label: string;
  multiple: boolean;
  onValueChange: (value: string[]) => void;
  tiles: readonly SourceTile[];
  /** The keys of the tiles picked. */
  value: readonly string[];
};

/**
 * A labeled grid of sources to pick, each a tile previewing it from the
 * frozen desk, or showing its icon large without a preview, over its icon
 * and name. The screen cast and screenshot pickers share it.
 */
export const SourceTiles = ({
  desk,
  label,
  multiple,
  onValueChange,
  tiles,
  value,
}: Props) => (
  <div className={groupStyles}>
    <span aria-hidden className={labelStyles}>
      {label}
    </span>
    <ToggleGroup
      aria-label={label}
      className={gridStyles}
      multiple={multiple}
      onValueChange={onValueChange}
      value={[...value]}
    >
      {tiles.map((tile) => (
        <Toggle className={tileStyles} key={tile.key} value={tile.key}>
          <span aria-hidden className={frameStyles}>
            {desk === undefined || tile.area === undefined ? (
              <span className={iconPreviewStyles} data-preview>
                {tile.icon}
              </span>
            ) : (
              <span
                className={shotStyles}
                data-preview
                style={cropped(desk, tile.area)}
              />
            )}
          </span>
          <span className={captionStyles}>
            {tile.icon}
            <span className={nameStyles}>{tile.name}</span>
          </span>
        </Toggle>
      ))}
    </ToggleGroup>
  </div>
);

const groupStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 2,
});

const labelStyles = css({ color: "muted", fontSize: "sm" });

const gridStyles = css({
  display: "grid",
  gap: 2,
  gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
});

const tileStyles = css({
  _hover: { backgroundColor: "card" },
  "&[data-pressed]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
    borderColor: "accent",
  },
  alignItems: "stretch",
  backgroundColor: "transparent",
  border: "1px solid transparent",
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  font: "inherit",
  gap: 2,
  minInlineSize: 0,
  padding: 2,
  textAlign: "start",
});

const frameStyles = css({
  alignItems: "center",
  aspectRatio: "16 / 10",
  backgroundColor: "card",
  borderRadius: "sm",
  display: "flex",
  justifyContent: "center",
  overflow: "hidden",
});

const iconPreviewStyles = css({
  "& :is(svg, img)": { blockSize: 10, inlineSize: 10 },
  color: "muted",
});

const shotStyles = css({
  backgroundRepeat: "no-repeat",
  maxBlockSize: "full",
  maxInlineSize: "full",
});

const captionStyles = css({
  "& > :is(svg, img)": { blockSize: 4, flexShrink: 0, inlineSize: 4 },
  alignItems: "center",
  display: "flex",
  fontSize: "sm",
  gap: 2,
  minInlineSize: 0,
});

const nameStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/**
 * Draws `area` of `desk`'s frame filling the tile's frame on its long side,
 * at its own aspect ratio.
 */
const cropped = (desk: FrozenDesk, area: ShotRect): CSSProperties => ({
  aspectRatio: `${String(area.width)} / ${String(area.height)}`,
  backgroundImage: `url(${desk.frame})`,
  backgroundPosition: `${offset(area.x, area.width, desk.width)} ${offset(area.y, area.height, desk.height)}`,
  backgroundSize: `${percent(desk.width, area.width)} ${percent(desk.height, area.height)}`,
  // Wider than the frame's 16:10 fills its width; taller fills its height.
  ...(area.width * 10 >= area.height * 16
    ? { inlineSize: "100%" }
    : { blockSize: "100%" }),
});

/** `whole` as a percent of `part`. */
const percent = (whole: number, part: number): string =>
  `${String((whole / part) * 100)}%`;

/**
 * The background position that puts `start` of a `whole` frame at the
 * edge of a `length` box.
 */
const offset = (start: number, length: number, whole: number): string =>
  whole === length ? "0%" : `${String((start / (whole - length)) * 100)}%`;
