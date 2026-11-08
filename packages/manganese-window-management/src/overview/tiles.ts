// Where the overview draws each workspace of a screen: a tile the screen's
// shape, and the view that shrinks the screen into it.

import type { Spot } from "../pointer-warp";
import type { Rect } from "../rect";

/** Room around the tiles, in page pixels. */
const MARGIN = 48;

/** Room between tiles, in page pixels. */
const GAP = 32;

/** Room under each tile for its workspace's name. */
export const LABEL = 32;

/** The most a tile shrinks the screen by, so one workspace is not huge. */
const LARGEST = 0.6;

/** One workspace in the overview. */
export type OverviewTile = {
  /** The screen shrunk, in page pixels. Its name goes under it. */
  box: Rect;
  name: string;
};

/**
 * A screen shrunk into a tile: page point `p` shows at `p * scale` offset by
 * `x` and `y`.
 */
export type View = { scale: number; x: number; y: number };

/**
 * A tile for each of `names`, in order, as large as fits in `area`: rows of
 * equal tiles the shape of `screen`, each row centered.
 */
export const tilesOf = (
  area: Rect,
  screen: Rect,
  names: readonly string[],
): OverviewTile[] => {
  const columns = bestColumns(area, screen, names.length);
  const width = tileWidth(area, screen, names.length, columns);
  const height = Math.round((width * screen.height) / screen.width);
  const rows = Math.ceil(names.length / columns);
  const tall = rows * (height + LABEL) + (rows - 1) * GAP;
  const top = area.y + Math.round((area.height - tall) / 2);
  return names.map((name, at) => {
    const row = Math.floor(at / columns);
    const inRow = Math.min(columns, names.length - row * columns);
    const wide = inRow * width + (inRow - 1) * GAP;
    const left = area.x + Math.round((area.width - wide) / 2);
    return {
      box: {
        height,
        width,
        x: left + (at % columns) * (width + GAP),
        y: top + row * (height + LABEL + GAP),
      },
      name,
    };
  });
};

/** The view that shows `screen` in `tile`. */
export const viewOf = (screen: Rect, tile: Rect): View => {
  const scale = tile.width / screen.width;
  return { scale, x: tile.x - screen.x * scale, y: tile.y - screen.y * scale };
};

/** The view that undoes `view`: the camera zoomed into its tile. */
export const inverseOf = ({ scale, x, y }: View): View => ({
  scale: 1 / scale,
  x: -x / scale,
  y: -y / scale,
});

/** `inner`, then `outer`, as one view. */
export const composed = (outer: View, inner: View): View => ({
  scale: outer.scale * inner.scale,
  x: outer.scale * inner.x + outer.x,
  y: outer.scale * inner.y + outer.y,
});

/**
 * `view`, of page points, for points measured from `origin` instead: for an
 * element placed there.
 */
export const fromOrigin = (view: View, origin: Rect): View => ({
  scale: view.scale,
  x: view.x + origin.x * view.scale - origin.x,
  y: view.y + origin.y * view.scale - origin.y,
});

/** `view` as a CSS transform, about the top left corner. */
export const matrixOf = ({ scale, x, y }: View): string =>
  `matrix(${scale.toString()}, 0, 0, ${scale.toString()}, ${x.toString()}, ${y.toString()})`;

/** Where `rect` shows through `view`. */
export const seenThrough = (view: View, rect: Rect): Rect => ({
  height: rect.height * view.scale,
  width: rect.width * view.scale,
  x: rect.x * view.scale + view.x,
  y: rect.y * view.scale + view.y,
});

/** The tile under page point `at`, if any. */
export const tileAt = (
  tiles: readonly OverviewTile[],
  [x, y]: Spot,
): OverviewTile | undefined =>
  tiles.find(
    ({ box }) =>
      x >= box.x &&
      x < box.x + box.width &&
      y >= box.y &&
      y < box.y + box.height,
  );

/** The column count that gives the largest tiles. */
const bestColumns = (area: Rect, screen: Rect, count: number): number =>
  Array.from({ length: Math.max(1, count) }, (_, at) => at + 1).reduce(
    (best, columns) =>
      tileWidth(area, screen, count, columns) >
      tileWidth(area, screen, count, best)
        ? columns
        : best,
    1,
  );

/** The width of each tile in `columns` columns, in whole pixels. */
const tileWidth = (
  area: Rect,
  screen: Rect,
  count: number,
  columns: number,
): number => {
  const rows = Math.ceil(count / columns);
  const across = (area.width - 2 * MARGIN - (columns - 1) * GAP) / columns;
  const down = (area.height - 2 * MARGIN - (rows - 1) * GAP) / rows - LABEL;
  return Math.floor(
    Math.min(
      across,
      (down * screen.width) / screen.height,
      screen.width * LARGEST,
    ),
  );
};
