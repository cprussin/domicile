// The cloth effect's sheet: a Verlet simulation of the grid's points that
// lets go of its top edge from left to right, then blows off to the right.
// The effect draws the window's pixels through the points `clothArrays` gives.
// The points are CSS pixels; the effect's vertex program scales them to device
// pixels.

type Point = { readonly x: number; readonly y: number };

/** The sheet at one moment. Points run row by row. */
export type Cloth = {
  readonly columns: number;
  readonly rows: number;
  readonly rest: readonly Point[];
  readonly at: readonly Point[];
  readonly previous: readonly Point[];
  readonly seconds: number;
};

/** How long the top edge takes to let go, left to right. */
const RELEASE_SECONDS = 0.3;
/** Pixels per second squared. */
const GRAVITY = 900;
const WIND = 2600;
/** How much of its speed a point keeps each step. */
const DAMPING = 0.985;
/** Passes over the links each step: more holds the sheet's shape better. */
const ITERATIONS = 4;
/** The darkest a fold gets. */
const DARKEST = 0.75;

/** A sheet of `columns` by `rows` cells, hanging still over a box. */
export const restingCloth = (
  columns: number,
  rows: number,
  width: number,
  height: number,
): Cloth => {
  const rest = Array.from(
    { length: (columns + 1) * (rows + 1) },
    (_, point) => ({
      x: ((point % (columns + 1)) * width) / columns,
      y: (Math.floor(point / (columns + 1)) * height) / rows,
    }),
  );
  return { at: rest, columns, previous: rest, rest, rows, seconds: 0 };
};

/** `cloth` `seconds` later. */
export const stepCloth = (cloth: Cloth, seconds: number): Cloth => {
  const time = cloth.seconds + seconds;
  const pinned = (point: number) => isPinned(cloth, point, time);
  const at = cloth.at.map((now, point) => {
    const before = pointAt(cloth.previous, point);
    // Gusts that differ down the sheet, so it flaps.
    const gust =
      0.6 +
      0.4 * Math.sin(time * 9 + Math.floor(point / (cloth.columns + 1)) * 0.7);
    return {
      x: now.x + (now.x - before.x) * DAMPING + WIND * gust * seconds * seconds,
      y:
        now.y +
        (now.y - before.y) * DAMPING +
        (GRAVITY - WIND * 0.3 * gust) * seconds * seconds,
    };
  });
  const held = holdLinks(cloth, at, pinned);
  return {
    ...cloth,
    at: held.map((point, index) =>
      pinned(index) ? pointAt(cloth.rest, index) : point,
    ),
    previous: cloth.at,
    seconds: time,
  };
};

/**
 * The effect's `points`: for each grid point, a float4 of its offset from
 * where it rests and its shade, 0 flat to {@link DARKEST} folded over.
 */
export const clothArrays = (cloth: Cloth): Float32Array =>
  Float32Array.from(
    cloth.at.flatMap((point, index) => {
      const rest = pointAt(cloth.rest, index);
      return [point.x - rest.x, point.y - rest.y, shade(cloth, index), 0];
    }),
  );

/** Whether `point` is still held: the top edge lets go left to right. */
const isPinned = (cloth: Cloth, point: number, time: number): boolean =>
  point <= cloth.columns && time < (RELEASE_SECONDS * point) / cloth.columns;

/**
 * `at` with each pair of neighbors moved back toward their resting
 * distance, {@link ITERATIONS} times over. A held point does not move.
 */
const holdLinks = (
  cloth: Cloth,
  at: readonly Point[],
  pinned: (point: number) => boolean,
): Point[] => {
  // Each pass moves points the last one moved, so this works in place.
  const points = at.map((point) => ({ ...point }));
  const pairs = links(cloth.columns, cloth.rows);
  for (let pass = 0; pass < ITERATIONS; pass += 1) {
    for (const [a, b] of pairs) {
      const from = pointAt(points, a);
      const to = pointAt(points, b);
      const restA = pointAt(cloth.rest, a);
      const restB = pointAt(cloth.rest, b);
      const length = Math.hypot(restB.x - restA.x, restB.y - restA.y);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const now = Math.hypot(dx, dy);
      const heldA = pinned(a);
      const heldB = pinned(b);
      const correction =
        now === 0 ? 0 : ((now - length) / now) * (heldA || heldB ? 1 : 0.5);
      if (!heldA) {
        points[a] = {
          x: from.x + dx * correction,
          y: from.y + dy * correction,
        };
      }
      if (!heldB) {
        points[b] = { x: to.x - dx * correction, y: to.y - dy * correction };
      }
    }
  }
  return points;
};

/** Each pair of neighboring points, across and down. */
const links = (columns: number, rows: number): [number, number][] =>
  Array.from({ length: (columns + 1) * (rows + 1) }, (_, point) => {
    const column = point % (columns + 1);
    const row = Math.floor(point / (columns + 1));
    const across: [number, number][] =
      column < columns ? [[point, point + 1]] : [];
    const down: [number, number][] =
      row < rows ? [[point, point + columns + 1]] : [];
    return [...across, ...down];
  }).flat();

/**
 * How folded the sheet is at `point`: how much the cell beside it shrank,
 * or turned over, from its resting area.
 */
const shade = (cloth: Cloth, point: number): number => {
  const column = point % (cloth.columns + 1);
  const row = Math.floor(point / (cloth.columns + 1));
  const across: [number, number] =
    column < cloth.columns ? [point, point + 1] : [point - 1, point];
  const down: [number, number] =
    row < cloth.rows
      ? [point, point + cloth.columns + 1]
      : [point - cloth.columns - 1, point];
  const area = (points: readonly Point[]) => {
    const a0 = pointAt(points, across[0]);
    const a1 = pointAt(points, across[1]);
    const b0 = pointAt(points, down[0]);
    const b1 = pointAt(points, down[1]);
    return (a1.x - a0.x) * (b1.y - b0.y) - (a1.y - a0.y) * (b1.x - b0.x);
  };
  return Math.min(Math.max(1 - area(cloth.at) / area(cloth.rest), 0), DARKEST);
};

/** Point `index`, which the grid always has. */
const pointAt = (points: readonly Point[], index: number): Point => {
  const point = points[index];
  if (point === undefined) {
    throw new RangeError(`the cloth has no point ${index.toString()}`);
  } else {
    return point;
  }
};
