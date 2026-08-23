import type { Display } from "@domicile/component-library/display-source";

/**
 * How big the desktop these displays make up is, in logical pixels.
 *
 * The bounding box, and not the widths added up: displays are laid out in two
 * dimensions, so a screen stacked under another one adds height rather than
 * width. A gap between two of them counts — the page spans it, and a window
 * dragged over it is at a real page coordinate that nothing is drawing.
 *
 * A size rather than a rectangle because the origin is not in question: the
 * compositor normalises the configured layout so the desktop's top-left corner
 * is `(0, 0)`, which is what makes `position + size` the far edge.
 *
 * `0` is the seed rather than the first display's edge, so a desktop of no
 * screens is `[0, 0]` instead of `-Infinity`. The compositor does not describe
 * one — it always has at least its own window — but this is arithmetic over a
 * list, and a list can be empty.
 */
export const desktopSize = (
  displays: readonly Display[],
): readonly [number, number] => [
  Math.max(0, ...displays.map(({ position, size }) => position[0] + size[0])),
  Math.max(0, ...displays.map(({ position, size }) => position[1] + size[1])),
];
