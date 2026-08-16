// 2D affine transforms as a 6-tuple [a, b, c, d, e, f], matching CSS
// `matrix(a,b,c,d,e,f)` and the `transform` field of domicile-protocol. A matrix
// maps a local point to screen space: screen = (a*x + c*y + e, b*x + d*y + f).
//
// This mirrors the Rust `domicile-scene::Transform`; the chrome computes the
// element->screen matrix here and ships it to the host, which inverts it to
// route input. Keeping the math identical on both sides avoids drift.

export type Matrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export type Point = readonly [x: number, y: number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const translate = (tx: number, ty: number): Matrix => [
  1,
  0,
  0,
  1,
  tx,
  ty,
];

export const scale = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0];

/** Counter-clockwise rotation by `radians`. */
export const rotate = (radians: number): Matrix => [
  Math.cos(radians),
  Math.sin(radians),
  -Math.sin(radians),
  Math.cos(radians),
  0,
  0,
];

/** Product `a·b`: the resulting matrix applies `b` first, then `a`. */
export const multiply = (left: Matrix, right: Matrix): Matrix => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

/** Map a point through the matrix. */
export const apply = (matrix: Matrix, [x, y]: Point): Point => [
  matrix[0] * x + matrix[2] * y + matrix[4],
  matrix[1] * x + matrix[3] * y + matrix[5],
];

// Below this the linear part is treated as singular: the determinant is small
// enough that the inverse would be dominated by floating-point noise.
const SINGULAR_DETERMINANT = 1e-12;

/** The inverse matrix, or `undefined` if the linear part is singular. */
export const invert = (matrix: Matrix): Matrix | undefined => {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - c * b;
  if (Math.abs(determinant) < SINGULAR_DETERMINANT) {
    return undefined;
  }
  const inverse = 1 / determinant;
  const ia = d * inverse;
  const ib = -b * inverse;
  const ic = -c * inverse;
  const id = a * inverse;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
};

/**
 * Compose an element->root chain into a single element->screen matrix.
 *
 * @param chain - Ordered element-first (the element's own transform), then
 *   each ancestor up to the root.
 */
export const accumulate = (chain: readonly Matrix[]): Matrix =>
  chain.reduce<Matrix>((acc, matrix) => multiply(matrix, acc), IDENTITY);
