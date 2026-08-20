// Which of an element's styles the compositor cannot draw.
//
// The compositor's shaders replace the engine's for app content, so an effect
// that is not reimplemented there is not applied at all. The window still
// draws — it just ignores the style, and it ignores it silently, which is the
// hard kind of wrong to find: the CSS is right, the element is right, and the
// picture is wrong for no visible reason.
//
// This does not decide anything. It names what was dropped so the author can
// be told, and so the per-window fallback to the copy path has something to
// key on when it lands.

import { parseShadow, ShadowKind, splitShadows } from "./shadow";

/** A style the compositor will not draw, named the way CSS names it. */
export type Unsupported = {
  /** The property at fault, e.g. `filter`. */
  property: string;
  /** Its computed value, so the author can find which rule set it. */
  value: string;
  /** What the window gets instead. */
  consequence: string;
};

/**
 * Everything about this element's **own** computed style the compositor will
 * ignore.
 *
 * Empty means nothing was found, not that nothing is wrong. CSS hides a great
 * deal from an element's own computed style: an ancestor's `filter`, an
 * ancestor's `opacity`, an `overflow: hidden` clip on a parent, and chrome
 * stacked between two windows are all dropped by the compositor and none of
 * them is visible here. Finding an ancestor's would mean walking the tree on
 * every measurement, which is a different and more expensive piece of work.
 *
 * Two kinds of thing are named. Effects the shader has no equivalent for at
 * all — a filter, a clip path — and effects it implements only in part, where
 * the window is drawn but not quite as asked. The second kind matters more,
 * because it looks nearly right.
 */
export const unsupportedEffects = (
  style: CSSStyleDeclaration,
): Unsupported[] => [
  ...NOT_REIMPLEMENTED.flatMap(({ property, key, initial, consequence }) => {
    const value = read(style, key);
    return value === undefined || value === initial
      ? []
      : [{ consequence, property, value }];
  }),
  ...partlyDrawn(style),
  ...flattened(style),
];

/**
 * A transform with perspective in it, which the compositor draws flat.
 *
 * Not the `perspective` *property*. That establishes a frustum for an element's
 * 3D-transformed **descendants** and says nothing about how the element itself
 * is drawn — so reading it reports windows that are perfectly correct, and
 * misses every window that is not. An element with `perspective()` in its own
 * transform list computes `perspective: none` and carries the projection in
 * its `matrix3d`, which is what this reads.
 *
 * An *ancestor's* `perspective` does not reach here at all: the child's matrix
 * is the un-projected one, so that case is invisible for the same reason an
 * ancestor's `filter` is.
 *
 * The projection is the fourth *row* — m14/m24/m34. `matrix3d` serialises
 * column-major, so the fourth column is the translation, two terms of which
 * the compositor keeps as `e` and `f`. The compositor keeps the six 2D terms
 * and discards the rest, which for a 3D transform *without* perspective is
 * exactly what CSS draws, and with one is not.
 */
const flattened = (style: CSSStyleDeclaration): Unsupported[] => {
  const transform = read(style, "transform");
  if (transform === undefined || !transform.startsWith("matrix3d(")) {
    return [];
  }
  const terms = transform
    .slice("matrix3d(".length, -1)
    .split(",")
    .map((term) => Number(term));
  // m14, m24, m34: the terms that make w vary with position, which is what
  // perspective is. A 3D rotation or scale leaves all three at zero.
  return [terms[3], terms[7], terms[11]].some((term) => term !== 0)
    ? [
        {
          consequence: "the window is drawn flat, without the perspective",
          property: "transform",
          value: transform,
        },
      ]
    : [];
};

// Effects with no counterpart in the compositor's shaders. Each is listed with
// the value that means "not asked for", because a computed style always has a
// value and only some of them mean anything.
const NOT_REIMPLEMENTED = [
  {
    consequence: "the window is drawn unfiltered",
    initial: "none",
    key: "filter",
    property: "filter",
  },
  {
    consequence: "the window is drawn over what is behind it, unaltered",
    initial: "none",
    key: "backdropFilter",
    property: "backdrop-filter",
  },
  {
    consequence: "the window is drawn whole, unclipped",
    initial: "none",
    key: "clipPath",
    property: "clip-path",
  },
  {
    consequence: "the window is drawn whole, unmasked",
    initial: "none",
    key: "maskImage",
    property: "mask-image",
  },
  {
    consequence: "the window is drawn normally, without blending",
    initial: "normal",
    key: "mixBlendMode",
    property: "mix-blend-mode",
  },
] as const;

/**
 * The effects the compositor draws, but not in every form CSS allows.
 *
 * These are worth more than the ones above: a window with no filter at all is
 * obviously missing something, where a window whose second shadow was dropped
 * looks like a window with one shadow, and nobody thinks to question it.
 */
const partlyDrawn = (style: CSSStyleDeclaration): Unsupported[] => {
  const shadows = read(style, "boxShadow") ?? "none";
  return [...droppedShadows(shadows), ...mismatchedCorners(style)];
};

/**
 * The shadows past the first, which are not drawn.
 *
 * What happens to the first one decides the wording, because "only the first is
 * drawn" is a lie when the first is `inset` — `parseShadow` declines an inset
 * shadow, so the window casts *none*, and an author told the first was drawn
 * goes looking for a shadow that was never there and concludes the feature is
 * broken.
 */
const droppedShadows = (computed: string): Unsupported[] => {
  const shadows = splitShadows(computed);
  if (shadows.length <= 1) {
    return [];
  }
  const first = parseShadow(computed);
  return [
    {
      consequence:
        first.kind === ShadowKind.Cast
          ? "only the first is drawn"
          : "none of them is drawn, because the first is one we decline",
      property: "box-shadow",
      value: computed,
    },
  ];
};

/**
 * The corner radii, when the window will not be drawn with the ones asked for.
 *
 * Three ways that happens, and the obvious one is the least dangerous. Four
 * corners that disagree, because a single radius is sent. A radius in `%`,
 * because the computed value keeps the `%` and the number in front of it is
 * then read as pixels — `border-radius: 50%` draws a 50-pixel corner. And the
 * two-axis `10px / 20px` form, whose computed longhands are each `10px 20px`,
 * of which only the first survives: an elliptical corner drawn circular.
 *
 * The last two are the ones that bite. All four corners agree, so nothing looks
 * inconsistent — the window is simply not the one that was asked for.
 *
 * All four or none: a corner that did not resolve is unknown rather than
 * different, and treating it as different would report every window in a DOM
 * implementation that computes nothing.
 */
const mismatchedCorners = (style: CSSStyleDeclaration): Unsupported[] => {
  const resolved = CORNERS.map((corner) => read(style, corner)).filter(
    (radius) => radius !== undefined,
  );
  const [first] = resolved;
  if (first === undefined || resolved.length !== CORNERS.length) {
    return [];
  }
  // Joined with commas because a two-axis radius holds a space of its own, and
  // four space-joined values that may each be a pair is not something anyone
  // can match against their stylesheet.
  const value = resolved.join(", ");
  if (resolved.some((radius) => radius !== first)) {
    return [
      {
        consequence: `all four corners are drawn at ${first}`,
        property: "border-radius",
        value,
      },
    ];
  }
  if (PIXELS.test(first)) {
    return [];
  }
  // What the window actually gets, which is what `readCornerRadius` will make
  // of the same string. A `calc()` survives into the computed value too, and
  // parses to nothing at all — so the window is drawn square, and saying
  // `NaNpx` would tell the author nothing about their screen.
  const drawn = Number.parseFloat(first);
  return [
    {
      consequence: Number.isFinite(drawn)
        ? `every corner is drawn at ${drawn}px`
        : "every corner is drawn square",
      property: "border-radius",
      value,
    },
  ];
};

// What can be sent: one absolute length. A percentage, a `calc()` or a
// two-axis pair reaches the compositor as whatever `parseFloat` makes of the
// front of it.
const PIXELS = /^-?[\d.]+px$/;

const CORNERS = [
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
] as const;

// Read the way the rest of the SDK reads a computed style: by property, not
// through `getPropertyValue`. An unresolved property is empty or absent, which
// is not the same as one set to its initial value — a DOM implementation that
// computes nothing must not report every window as unsupported.
const read = (
  style: CSSStyleDeclaration,
  key: keyof CSSStyleDeclaration,
): string | undefined => {
  const value = style[key];
  return typeof value === "string" && value !== "" ? value.trim() : undefined;
};
