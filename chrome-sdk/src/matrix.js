// 2D affine transforms as a 6-tuple [a, b, c, d, e, f], matching CSS
// `matrix(a,b,c,d,e,f)` and the `transform` field of dm-protocol. A matrix maps
// a local point to screen space: screen = (a*x + c*y + e, b*x + d*y + f).
//
// This mirrors the Rust `dm-scene::Transform`; the chrome computes the
// element->screen matrix here and ships it to the host, which inverts it to
// route input. Keeping the math identical on both sides avoids drift.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx, sy) {
  return [sx, 0, 0, sy, 0, 0];
}

/** Counter-clockwise rotation by `radians`. */
export function rotate(radians) {
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  return [c, s, -s, c, 0, 0];
}

/** Product `a·b`: the resulting matrix applies `b` first, then `a`. */
export function multiply(a, b) {
  const [a1, b1, c1, d1, e1, f1] = a;
  const [a2, b2, c2, d2, e2, f2] = b;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Map a point `[x, y]` through the matrix. */
export function apply(m, [x, y]) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The inverse matrix, or `null` if the linear part is singular. */
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - c * b;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const ia = d * inv;
  const ib = -b * inv;
  const ic = -c * inv;
  const id = a * inv;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/**
 * Compose an element->root chain into a single element->screen matrix.
 * `chain` is ordered element-first (the element's own transform), then each
 * ancestor up to the root. Applying the result maps element-local coordinates
 * to screen space.
 */
export function accumulate(chain) {
  return chain.reduce((acc, m) => multiply(m, acc), IDENTITY);
}
