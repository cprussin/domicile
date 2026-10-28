/**
 * Phosphor icons whose moving parts Phosphor merges into one outline, drawn
 * again as separate parts that cover the same ground at rest: each is the
 * same strokes and boxes, so the outline the parts join into is Phosphor's.
 * As in Phosphor's paths, outlines run counterclockwise and holes clockwise.
 */

/** X regular: its two 16-wide strokes, top start first. */
export const X_REGULAR = {
  arms: [
    "M61.66 50.34L205.66 194.34A8 8 0 0 1 194.34 205.66L50.34 61.66A8 8 0 0 1 61.66 50.34Z",
    "M194.34 50.34A8 8 0 0 1 205.66 61.66L61.66 205.66A8 8 0 0 1 50.34 194.34Z",
  ],
} as const;

/** Plus regular: its two 16-wide strokes, across first. */
export const PLUS_REGULAR = {
  arms: [
    "M40 120H216A8 8 0 0 1 216 136H40A8 8 0 0 1 40 120Z",
    "M120 40A8 8 0 0 1 136 40V216A8 8 0 0 1 120 216Z",
  ],
} as const;

/**
 * Browsers regular: the window behind, whole, the window in front, and the
 * front window's outline, which masks the one behind where it overlaps.
 */
export const BROWSERS_REGULAR = {
  back: "M216 40H72A16 16 0 0 0 56 56V168A16 16 0 0 0 72 184H216A16 16 0 0 0 232 168V56A16 16 0 0 0 216 40ZM72 56H216V168H72Z",
  front:
    "M184 72H40A16 16 0 0 0 24 88V200A16 16 0 0 0 40 216H184A16 16 0 0 0 200 200V88A16 16 0 0 0 184 72ZM184 88V104H40V88ZM184 200H40V120H184V200Z",
  frontOutline:
    "M184 72H40A16 16 0 0 0 24 88V200A16 16 0 0 0 40 216H184A16 16 0 0 0 200 200V88A16 16 0 0 0 184 72Z",
} as const;

/**
 * SquareSplitHorizontal and SquareSplitVertical regular: their shared frame,
 * and the divider each draws inside it.
 */
export const SQUARE_SPLIT_REGULAR = {
  frame:
    "M200 40H56A16 16 0 0 0 40 56V200A16 16 0 0 0 56 216H200A16 16 0 0 0 216 200V56A16 16 0 0 0 200 40ZM56 56H200V200H56Z",
  horizontal: "M120 56H136V200H120Z",
  vertical: "M56 120H200V136H56Z",
} as const;

/**
 * CaretLeft, CaretUp, CaretRight and CaretDown regular: their two 16-wide
 * strokes, the one that turns clockwise to meet the other first, and the tip
 * they meet at.
 */
export const CARET_REGULAR = {
  down: {
    arms: [
      "M42.34 101.66L122.34 181.66A8 8 0 0 0 133.66 170.34L53.66 90.34A8 8 0 0 0 42.34 101.66Z",
      "M133.66 181.66L213.66 101.66A8 8 0 0 0 202.34 90.34L122.34 170.34A8 8 0 0 0 133.66 181.66Z",
    ],
    tip: [128, 176],
  },
  left: {
    arms: [
      "M154.34 42.34L74.34 122.34A8 8 0 0 0 85.66 133.66L165.66 53.66A8 8 0 0 0 154.34 42.34Z",
      "M74.34 133.66L154.34 213.66A8 8 0 0 0 165.66 202.34L85.66 122.34A8 8 0 0 0 74.34 133.66Z",
    ],
    tip: [80, 128],
  },
  right: {
    arms: [
      "M101.66 213.66L181.66 133.66A8 8 0 0 0 170.34 122.34L90.34 202.34A8 8 0 0 0 101.66 213.66Z",
      "M181.66 122.34L101.66 42.34A8 8 0 0 0 90.34 53.66L170.34 133.66A8 8 0 0 0 181.66 122.34Z",
    ],
    tip: [176, 128],
  },
  up: {
    arms: [
      "M213.66 154.34L133.66 74.34A8 8 0 0 0 122.34 85.66L202.34 165.66A8 8 0 0 0 213.66 154.34Z",
      "M122.34 74.34L42.34 154.34A8 8 0 0 0 53.66 165.66L133.66 85.66A8 8 0 0 0 122.34 74.34Z",
    ],
    tip: [128, 80],
  },
} as const;

/** X bold: its two 24-wide strokes, top start first. */
export const X_BOLD = {
  arms: [
    "M47.51 64.49L191.51 208.49A12 12 0 0 0 208.49 191.51L64.49 47.51A12 12 0 0 0 47.51 64.49Z",
    "M191.51 47.51L47.51 191.51A12 12 0 0 0 64.49 208.49L208.49 64.49A12 12 0 0 0 191.51 47.51Z",
  ],
} as const;

/** Plus bold: its two 24-wide strokes, across first. */
export const PLUS_BOLD = {
  arms: [
    "M40 140L216 140A12 12 0 0 0 216 116L40 116A12 12 0 0 0 40 140Z",
    "M116 40L116 216A12 12 0 0 0 140 216L140 40A12 12 0 0 0 116 40Z",
  ],
} as const;

/** Minus bold: its one 24-wide stroke. */
export const MINUS_BOLD = {
  bar: "M40 140L216 140A12 12 0 0 0 216 116L40 116A12 12 0 0 0 40 140Z",
} as const;

/** Lock regular: its body, its shackle and its keyhole. */
export const LOCK_REGULAR = {
  body: "M208 80H48A16 16 0 0 0 32 96V208A16 16 0 0 0 48 224H208A16 16 0 0 0 224 208V96A16 16 0 0 0 208 80ZM208 208H48V96H208V208Z",
  keyhole: "M140 152A12 12 0 1 1 128 140 12 12 0 0 1 140 152Z",
  shackle: "M80 80V56A48 48 0 0 1 176 56V80H160V56A32 32 0 0 0 96 56V80Z",
} as const;

/**
 * SlidersHorizontal regular: its tracks and knobs, top first, and each
 * knob's disk, which masks its track where the knob sits.
 */
export const SLIDERS_REGULAR = {
  knobDisks: [
    "M136 80A32 32 0 1 0 72 80A32 32 0 1 0 136 80Z",
    "M200 176A32 32 0 1 0 136 176A32 32 0 1 0 200 176Z",
  ],
  knobs: [
    "M136 80A32 32 0 1 0 72 80A32 32 0 1 0 136 80ZM120 80A16 16 0 1 1 88 80A16 16 0 1 1 120 80Z",
    "M200 176A32 32 0 1 0 136 176A32 32 0 1 0 200 176ZM184 176A16 16 0 1 1 152 176A16 16 0 1 1 184 176Z",
  ],
  tracks: [
    "M40 88L216 88A8 8 0 0 0 216 72L40 72A8 8 0 0 0 40 88Z",
    "M40 184L216 184A8 8 0 0 0 216 168L40 168A8 8 0 0 0 40 184Z",
  ],
} as const;
