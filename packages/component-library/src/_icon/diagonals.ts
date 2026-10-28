/**
 * The ways four corner parts move apart, as `IconPart` directions: top
 * start, top end, bottom start, bottom end. Physical, since icons do not
 * mirror.
 */
export const DIAGONALS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
