// How the chrome reports an `<domicile-app>`'s on-screen box to the host.

import { elementToScreen } from "./element-transform";
import type { Matrix, Point } from "./matrix";
import { IDENTITY } from "./matrix";
import type { Shadow } from "./shadow";
import { parseShadow, ShadowKind } from "./shadow";
import { parseTransformOrigin } from "./transform-origin";

/** An element's geometry in the form `place_portal` needs it. */
export type Measurement = {
  size: readonly [width: number, height: number];
  transform: Matrix;
  zIndex: number;
  visible: boolean;
  /** `border-radius` in logical pixels; 0 for a square window. */
  cornerRadius: number;
  /** `opacity`, 0 to 1. */
  opacity: number;
  /** The first drawable `box-shadow`, if the element has one. */
  shadow: Shadow | undefined;
};

export type Measure = (element: HTMLElement) => Measurement;

/**
 * Default DOM measurement: element-local size plus an element->screen affine.
 *
 * The affine composes the element's own CSS transform (about its
 * `transform-origin`) with where `getBoundingClientRect` puts the result, so a
 * rotated or scaled app maps correctly in both directions. An *ancestor* that
 * rotates or skews is still missed — `getBoundingClientRect` only reports an
 * axis-aligned box, so there is nothing left to recover it from. The engine
 * integration, which knows each layer's transform outright, replaces this when
 * running inside the compositor.
 */
export const defaultMeasure: Measure = (element) => {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const size = [
    firstNonZero(element.offsetWidth, box.width),
    firstNonZero(element.offsetHeight, box.height),
  ] as const;
  return {
    cornerRadius: readCornerRadius(style),
    opacity: readOpacity(style),
    shadow: readShadow(style),
    size,
    transform: elementToScreen({
      box,
      linear: readElementTransform(style),
      // An uncomputed origin means a DOM implementation that resolves no
      // style, where the CSS initial value (the element's centre) applies.
      origin: parseTransformOrigin(style.transformOrigin) ?? centreOf(size),
      size,
    }),
    visible: size[0] > 0 && size[1] > 0,
    zIndex: readZIndex(style),
  };
};

// Layout-dependent measurements read 0 before the element has a box; the
// caller wants the first source that actually produced one.
/**
 * `border-radius` as one number of pixels.
 *
 * The compositor applies a single radius to all four corners — that is what its
 * shader can do without knowing which way up a client's buffer is — so an
 * element with four different ones reports the first, which is the one it set if
 * it set one at all. A radius in `%` computes to `px` here, because
 * `getComputedStyle` resolves it against the element's own box.
 *
 * Anything unparseable is no rounding rather than a guess: a square window is
 * the honest floor, and a wrong radius clips content.
 */
const readCornerRadius = (style: CSSStyleDeclaration): number =>
  finiteOrZero(Number.parseFloat(style.borderTopLeftRadius));

/**
 * `opacity`, clamped to what it can mean.
 *
 * A missing or unparseable value is fully opaque, never transparent: a window
 * nobody can see is a worse failure than one that ignores a style, and it is
 * indistinguishable from the compositor not drawing at all.
 */
const readOpacity = (style: CSSStyleDeclaration): number => {
  const opacity = Number.parseFloat(style.opacity);
  return Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : 1;
};

/**
 * The `box-shadow` the compositor should cast, if it can cast it.
 *
 * Only the outer shadows the shader knows how to draw; an `inset` one is no
 * shadow, which is the same thing the element gets today.
 *
 * The engine paints this shadow too — it is ordinary CSS on an ordinary
 * element, and the placeholder being transparent does not stop a `box-shadow`
 * from being ink. Casting it in the compositor is what puts it in the right
 * place: the chrome is drawn over the apps, so an engine-painted shadow lands
 * on top of any window it overlaps rather than under its own.
 *
 * An element that asked for a shadow in a syntax this cannot read is reported,
 * once per distinct value. Silently dropping it would be indistinguishable from
 * the compositor not drawing at all, and the author has no other way to find
 * out that the syntax they wrote is one this does not read. An `inset` shadow
 * is not that case — it is read, understood, and declined on purpose.
 */
const readShadow = (style: CSSStyleDeclaration): Shadow | undefined => {
  const computed = style.boxShadow;
  const reading = parseShadow(computed);
  switch (reading.kind) {
    case ShadowKind.Cast: {
      return reading.shadow;
    }
    case ShadowKind.Unreadable: {
      reportUnreadable("box-shadow", computed);
      return undefined;
    }
    case ShadowKind.None:
    case ShadowKind.Inset: {
      return undefined;
    }
  }
};

// Measurement runs on every resize, so the same unreadable value would
// otherwise be reported many times a second.
//
// Bounded, because the key is the whole computed string and a `transition` on
// `box-shadow` produces a new one every frame. Past the cap the reports stop
// rather than the memory growing: the first few name the syntax at fault,
// which is the whole job, and an unbounded set on a path that runs per resize
// is a worse bug than the one it is reporting.
const REPORT_LIMIT = 32;
const reported = new Set<string>();

/**
 * Say so, once, that an element asked for something this could not read.
 *
 * The console is the only channel the SDK has to whoever wrote the CSS, and a
 * window that silently loses a style is indistinguishable from one the
 * compositor never drew — which is the failure that is impossible to debug.
 */
const reportUnreadable = (property: string, computed: string): void => {
  const seen = `${property}: ${computed}`;
  if (!reported.has(seen) && reported.size < REPORT_LIMIT) {
    reported.add(seen);
    // biome-ignore lint/suspicious/noConsole: the only channel to the author
    console.warn(
      `domicile: cannot read ${property} ${JSON.stringify(computed)}; ` +
        `this window will be drawn without it`,
    );
  }
};

const finiteOrZero = (value: number): number =>
  Number.isFinite(value) ? Math.max(value, 0) : 0;

const firstNonZero = (preferred: number, fallback: number): number =>
  preferred > 0 ? preferred : fallback;

/**
 * Everything the element does to its own coordinate system, as one matrix.
 *
 * `transform` is not the whole story: `rotate` and `scale` are properties in
 * their own right, and neither appears in the computed `transform`. An element
 * written with them turns or stretches in the page while a compositor reading
 * only `transform` draws the window square — a disagreement with no error
 * anywhere to notice it.
 *
 * CSS applies them in a fixed order — translate, then rotate, then scale, then
 * `transform` — all about the same `transform-origin`, which is why they can be
 * composed here and the origin left to `elementToScreen`.
 *
 * `translate` is deliberately absent. It is a pure translation, so it cannot
 * change the linear part, and the position it does contribute is already in the
 * `getBoundingClientRect` that `elementToScreen` derives the offset from — the
 * two cancel exactly. Including it would also break the commonest centring
 * idiom in CSS: computed `translate` keeps its percentages where `transform`
 * resolves them, and a matrix cannot be built from a relative length, so
 * `translate: -50% -50%` threw out of every measurement.
 *
 * `DOMMatrix` is absent in some non-browser DOM implementations, where an
 * identity transform is the correct answer: those environments do no layout and
 * so apply no transform either.
 */
const readElementTransform = (style: CSSStyleDeclaration): Matrix => {
  if (typeof DOMMatrix === "undefined") {
    return IDENTITY;
  }
  const parts = [
    asRotate(style.rotate),
    asScale(style.scale),
    // Already a transform list, so it goes in as it stands.
    isSet(style.transform) ? style.transform : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) {
    return IDENTITY;
  }
  // Multiplied one at a time rather than concatenated into a list for
  // `DOMMatrix` to parse. happy-dom's implementation — the one the unit tests
  // run against — lets a `matrix(...)` reset the accumulator, so `scale(2)
  // matrix(...)` silently loses the scale. Chromium composes the list
  // correctly, so this is not a production bug; it is what stops the unit
  // tests measuring a happy-dom artefact instead of the real arithmetic.
  const matrix = parts.reduce(
    (composed, part) => composed.multiply(new DOMMatrix(part)),
    new DOMMatrix(),
  );
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
};

/**
 * `rotate` as a CSS transform function.
 *
 * Three shapes reach here: a bare angle, an axis keyword and an angle, and an
 * axis vector and an angle. CSS spells the last two with `rotate3d` rather than
 * `rotate`, and emitting `rotate(x, 45deg)` gets an element that turns in the
 * page and a window that does not — silently in a DOM implementation that
 * shrugs at bad syntax, and by throwing in one that does not.
 *
 * A 3D rotation is kept rather than refused because the 2D part of the matrix
 * is exactly what CSS draws for one with no `perspective` in the chain: the
 * drop-z orthographic projection, which for a 45-degree turn about x is the
 * vertical squash a browser really shows.
 */
const asRotate = (value: string | undefined): string | undefined => {
  const parts = components(value);
  switch (parts.length) {
    case 0: {
      return undefined;
    }
    case 1: {
      return `rotate(${parts[0]})`;
    }
    case 2: {
      const axis = AXES[parts[0]?.toLowerCase() ?? ""];
      return axis === undefined
        ? unreadable("rotate", value)
        : `rotate3d(${axis}, ${parts[1]})`;
    }
    case 4: {
      return `rotate3d(${parts.join(", ")})`;
    }
    default: {
      return unreadable("rotate", value);
    }
  }
};

const AXES: Record<string, string | undefined> = {
  x: "1, 0, 0",
  y: "0, 1, 0",
  z: "0, 0, 1",
};

/**
 * `scale` as a CSS transform function; three components is `scale3d`.
 *
 * The components go in verbatim, which would be a problem if a percentage
 * could reach here — `DOMMatrix` rejects those, as `translate` found out. It
 * cannot: `scale`'s percentages resolve against 1 with no layout to depend on,
 * so they are gone by the computed value. Checked in Chromium rather than
 * reasoned about, because the same assumption about `translate` was wrong:
 * `scale: 50%` computes to `0.5`, where `translate: -50% -50%` stays itself.
 */
const asScale = (value: string | undefined): string | undefined => {
  const parts = components(value);
  switch (parts.length) {
    case 0: {
      return undefined;
    }
    case 1:
    case 2: {
      return `scale(${parts.join(", ")})`;
    }
    case 3: {
      return `scale3d(${parts.join(", ")})`;
    }
    default: {
      return unreadable("scale", value);
    }
  }
};

// The independent properties compute to bare component lists — `45deg`,
// `2 3` — rather than to functions, and the components are space-separated.
const components = (value: string | undefined): string[] =>
  isSet(value) ? value.trim().split(/\s+/) : [];

// `none` is the initial value of all of them, and an unresolved style reads
// empty.
const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "" && value !== "none";

// A shape none of the above accounts for. Reported rather than dropped, for
// the same reason an unreadable shadow is: a window that quietly ignores a
// style it was given is the failure nobody can debug.
const unreadable = (property: string, value: string | undefined): undefined => {
  reportUnreadable(property, value ?? "");
  return undefined;
};

const centreOf = ([width, height]: Point): Point => [width / 2, height / 2];

// `z-index: auto` parses to NaN, which the host reads as the default layer.
const readZIndex = (style: CSSStyleDeclaration): number => {
  const zIndex = Number.parseInt(style.zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
};
