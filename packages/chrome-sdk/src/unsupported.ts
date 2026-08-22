// Which of an element's styles the compositor cannot draw natively.
//
// The compositor's shaders replace the engine's for app content, so an effect
// that is not reimplemented there has no counterpart on the native path. What
// names one is what sends that window — and only that window — back down the
// copy path, where the engine draws the client's pixels as ordinary content.
//
// So nothing here is a list of what the author loses. It is the list of what
// their window costs: a readback and a socket hop per frame, instead of none.
//
// Three of these — `filter`, `clip-path` and `mask-image` — are self-contained
// and really are drawn correctly once the pixels are in the page. The two that
// read what is *behind* the element are not, and are listed because the copy
// path is no worse rather than because it is right: `present()` draws the app
// surfaces and then the page over all of them, so the backdrop the engine can
// see is the page's own content. A `backdrop-filter` on a window therefore
// blurs the transparent hole of whatever is behind it rather than the window
// there, and `mix-blend-mode` blends with the page rather than with the window
// it is stacked over. Both want the compositor to do the reading, which is a
// shader that does not exist yet.
//
// The same ordering costs every window on this list something, whatever the
// effect: the page is drawn over all of the app surfaces rather than in the
// stacking order, so a window whose pixels move into the page is drawn above
// every *natively* drawn window it overlaps, whatever its `z-index`. That is
// the interleaved-stacking limitation in WINDOW-COMPOSITING.md, which used to
// be reachable only by putting chrome between two windows and is now reachable
// by writing a `filter` on one. What fixes it is drawing the chrome texture
// more than once; that doc's open question is which way.

import { parseShadow, ShadowKind, splitShadows } from "./shadow";

/** A style the compositor cannot draw natively, named the way CSS names it. */
export type Unsupported = {
  /** The property at fault, e.g. `filter`. */
  property: string;
  /** Its computed value, so the author can find which rule set it. */
  value: string;
};

/**
 * Everything about this element's **own** computed style the compositor will
 * ignore.
 *
 * Empty means nothing was found, not that nothing is wrong. CSS hides a great
 * deal from an element's own computed style: an ancestor's `filter`, an
 * ancestor's `opacity`, an `overflow: hidden` clip on a parent, and chrome
 * stacked between two windows are all dropped by the compositor and none of
 * them is visible here.
 *
 * Finding an ancestor's is no longer expensive — `defaultMeasure` walks the
 * flat tree and already holds each ancestor's computed style — but it is a
 * different question rather than a longer version of this one. Reporting an
 * ancestor's `filter` would take every window inside a filtered container off
 * the native path, which is a decision about a great many more windows than
 * any of these, and one nothing has measured. The gap is recorded in ROADMAP
 * rather than closed here.
 *
 * Two kinds of thing are named. Effects the shader has no equivalent for at
 * all — a filter, a clip path — and effects it implements only in part, where
 * it would draw the window but not quite as asked. The second kind matters
 * more, because a window drawn nearly right is the one nobody questions.
 */
export const unsupportedEffects = (
  style: CSSStyleDeclaration,
): Unsupported[] => [
  ...NOT_REIMPLEMENTED.flatMap(({ property, key, initial }) => {
    const value = read(style, key);
    return value === undefined || value === initial
      ? []
      : [{ property, value }];
  }),
  ...partlyDrawn(style),
  ...flattened(style),
  ...hiddenBackface(style),
];

/**
 * A transform with perspective in it, which the compositor cannot draw.
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
    ? [{ property: "transform", value: transform }]
    : [];
};

// Effects with no counterpart in the compositor's shaders. Each is listed with
// the value that means "not asked for", because a computed style always has a
// value and only some of them mean anything.
const NOT_REIMPLEMENTED = [
  { initial: "none", key: "filter", property: "filter" },
  { initial: "none", key: "backdropFilter", property: "backdrop-filter" },
  { initial: "none", key: "clipPath", property: "clip-path" },
  { initial: "none", key: "maskImage", property: "mask-image" },
  { initial: "normal", key: "mixBlendMode", property: "mix-blend-mode" },
] as const;

/**
 * `backface-visibility: hidden` on an element that is actually turned in 3D.
 *
 * Not caught by `flattened`: `rotateY(180deg)` has no perspective in it, so its
 * `matrix3d` passes, and the compositor keeps the six 2D terms and draws the
 * window mirrored — while CSS hides it outright. The two pictures could hardly
 * disagree more.
 *
 * The property alone is not enough to say so, and reading it that way is a
 * false positive on the commonest use of it by far: `backface-visibility:
 * hidden` with no 3D transform anywhere is the old promote-to-its-own-layer
 * flicker hack, on elements that never turn. Those windows are drawn
 * identically by both paths, and reporting them would move a desktop's worth
 * of windows onto the copy path to fix nothing.
 *
 * A backface can only be turned towards the viewer by a rotation out of the
 * plane, which reaches the computed style one of two ways: in the `transform`
 * list, where any 3D function makes the whole thing serialise as `matrix3d`,
 * or in the independent `rotate` property, where an axis form has more than
 * one component. Either is enough to ask the question; neither is a promise
 * that the element is turned *past* ninety degrees, so this over-reports
 * within the 3D case and does not try to be exact about an angle.
 */
const hiddenBackface = (style: CSSStyleDeclaration): Unsupported[] => {
  const value = read(style, "backfaceVisibility");
  return value === "hidden" && turnsOutOfThePlane(style)
    ? [{ property: "backface-visibility", value }]
    : [];
};

const turnsOutOfThePlane = (style: CSSStyleDeclaration): boolean =>
  (read(style, "transform")?.startsWith("matrix3d(") ?? false) ||
  (read(style, "rotate")?.split(/\s+/).length ?? 0) > 1;

/**
 * The effects the compositor draws, but not in every form CSS allows.
 *
 * These are worth more than the ones above: a window with no filter at all is
 * obviously missing something, where a window whose second shadow was dropped
 * looks like a window with one shadow, and nobody thinks to question it. Both
 * kinds go the same way now — off the native path — but only because these
 * were found at all.
 */
const partlyDrawn = (style: CSSStyleDeclaration): Unsupported[] => {
  const shadows = read(style, "boxShadow") ?? "none";
  return [...droppedShadows(shadows), ...mismatchedCorners(style)];
};

/**
 * A `box-shadow` the shader would not cast the way the engine would.
 *
 * The shader casts one shadow, and it is the first in the list — so a second
 * has nowhere to go, and a first that cannot be cast takes the one behind it
 * down with it: an `inset` shadow followed by an ordinary one leaves the
 * window casting nothing while CSS casts something.
 *
 * `inset` on its own is the case that stays, and the reason is the opposite of
 * what it looks like. CSS paints an inset shadow inside the padding box, above
 * the background and *below the content* — and on the native path this element
 * has no content at all, so the engine paints the shadow into the page, which
 * `present()` composites over the app surfaces. An inset shadow is therefore
 * already drawn, by the engine, over the client's own pixels.
 *
 * The copy path is the one that loses it, because there the content is a
 * canvas holding the whole opaque client and the shadow goes under it. So
 * handing a window over for an inset shadow would buy a readback per frame and
 * *remove* a shadow that was working. It is left alone.
 *
 * The corollary is a gap rather than a decision: a window with an inset shadow
 * and any other undrawable style goes to the copy path for that other style
 * and drops the inset shadow on the way. Nothing here can prevent that; the
 * copy path would have to paint it over the canvas rather than under it.
 */
const droppedShadows = (computed: string): Unsupported[] => {
  const kinds = splitShadows(computed).map(
    (shadow) => parseShadow(shadow).kind,
  );
  // Unreadable counts as outer, because it is unknown rather than inset — and
  // a shadow this cannot read is one the engine can, which is the whole reason
  // to hand the window over.
  const outer = kinds.filter((kind) => kind !== ShadowKind.Inset);
  return outer.length > 0 && (outer.length > 1 || kinds[0] !== ShadowKind.Cast)
    ? [{ property: "box-shadow", value: computed }]
    : [];
};

/**
 * The corner radii, when the shader cannot round the window the way asked.
 *
 * Three ways that happens, and the obvious one is the least dangerous. Four
 * corners that disagree, because a single radius is sent. A radius in `%`,
 * because the computed value keeps the `%` and the number in front of it would
 * then be read as pixels — `border-radius: 50%` as a 50-pixel corner. And the
 * two-axis `10px / 20px` form, whose computed longhands are each `10px 20px`,
 * of which only the first would survive: an elliptical corner drawn circular.
 *
 * The last two are the ones that bite. All four corners agree, so nothing looks
 * inconsistent — the window would simply not be the one that was asked for.
 *
 * All four or none: a corner that did not resolve is unknown rather than
 * different, and treating it as different would take every window off the
 * native path in a DOM implementation that computes nothing.
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
  return resolved.some((radius) => radius !== first) || !PIXELS.test(first)
    ? [{ property: "border-radius", value: resolved.join(", ") }]
    : [];
};

// What can be sent: one absolute length. A percentage, a `calc()` or a
// two-axis pair has no absolute number in it to send at all.
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
