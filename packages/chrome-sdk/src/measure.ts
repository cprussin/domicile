// Measures an `<app>`'s size and element->screen transform.
//
// Pointer input uses these to map a screen position into the client's
// surface pixels. Window placement is plain CSS and does not use them.

import { elementToScreen } from "./element-transform";
import type { Matrix } from "./matrix";
import { accumulate, IDENTITY, multiply, scale } from "./matrix";

export type Measurement = {
  size: readonly [width: number, height: number];
  transform: Matrix;
};

export type Measure = (element: HTMLElement) => Measurement;

/**
 * Default DOM measurement: element-local size plus an element->screen affine.
 *
 * Composes the CSS transforms of the element and its flat-tree ancestors, the
 * effective `zoom`, and the `getBoundingClientRect` position. Stops at a
 * top-layer element (open `<dialog>` or popover).
 *
 * Limits:
 *
 * - A perspective projection cannot be an affine. This uses the flattened 2D
 *   part and logs a warning via {@link reportProjection}.
 * - Paint-order differences beyond slots and shadow hosts are not followed.
 */
export const defaultMeasure: Measure = (element) => {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const size = [
    firstNonZero(element.offsetWidth, box.width),
    firstNonZero(element.offsetHeight, box.height),
  ] as const;
  return {
    size,
    transform: elementToScreen({
      box,
      linear: chainToScreen(element, style),
      size,
    }),
  };
};

/**
 * The linear part of the element->screen transform: the element's transform,
 * then each ancestor's, times the effective zoom.
 *
 * Only linear parts are composed. Origins and layout offsets only add
 * translations, and `elementToScreen` solves for the translation from
 * `getBoundingClientRect`, so they need not be tracked.
 *
 * Runs on every `pointermove`, with one `getComputedStyle` per ancestor.
 */
const chainToScreen = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
): Matrix => {
  const chain = layersToScreen(element, style);
  reportProjection(chain);
  const zoom = zoomOver(element);
  return multiply(
    accumulate(chain.map(({ matrix }) => linearPart(matrix))),
    scale(zoom, zoom),
  );
};

/** One element in the chain to the screen, with its computed transform. */
type Layer = {
  style: CSSStyleDeclaration;
  matrix: DOMMatrix | undefined;
};

/** The element and the elements it is painted inside, element-first. */
const layersToScreen = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
): Layer[] => {
  const chain = [readLayer(style)];
  // Ancestors' transforms do not apply to a top-layer element.
  if (!inTopLayer(element)) {
    for (
      let above = paintedInside(element);
      above !== undefined;
      above = paintedInside(above)
    ) {
      chain.push(readLayer(getComputedStyle(above)));
      // A top-layer ancestor's transform applies, but not its ancestors'.
      if (inTopLayer(above)) {
        break;
      }
    }
  }
  return chain;
};

const readLayer = (style: CSSStyleDeclaration): Layer => ({
  matrix: readElementTransform(style),
  style,
});

/**
 * The element this one is painted inside: its slot, shadow host or parent.
 *
 * `parentElement` is wrong for slotted content and null at a shadow root.
 */
const paintedInside = (element: Element): HTMLElement | undefined => {
  // Some DOM implementations return `undefined` rather than `null`.
  const slot: HTMLSlotElement | null | undefined = element.assignedSlot;
  const parent: Node | null = element.parentNode;
  if (slot !== null && slot !== undefined) {
    return slot;
  } else if (parent === null) {
    return undefined;
  } else if (parent instanceof ShadowRoot) {
    return parent.host instanceof HTMLElement ? parent.host : undefined;
  } else {
    return parent instanceof HTMLElement ? parent : undefined;
  }
};

/**
 * Whether this element is painted in the top layer (modal or open popover).
 *
 * Unguarded: an engine without `:popover-open` throws, which is better than
 * silently answering `false`.
 */
const inTopLayer = (element: Element): boolean =>
  element.matches(":modal, :popover-open");

/**
 * The compounded CSS `zoom` over this element (`currentCSSZoom`).
 *
 * `offsetWidth` excludes CSS zoom, while `getBoundingClientRect` and
 * `clientX` include it (under `StandardizedBrowserZoom`), so the affine needs
 * this factor between them. Defaults to 1 where the DOM does no layout.
 */
const zoomOver = (element: Element): number => {
  const zoom: number | undefined = element.currentCSSZoom;
  return zoom ?? 1;
};

/**
 * Warns when a perspective projection applies to the window, since the affine
 * mapping will then send clicks to the wrong place.
 *
 * Detects a `perspective()` in an element's own transform
 * ({@link bendsThePlane}), and a `perspective` property above an element that
 * leaves the plane without being flattened first (no `preserve-3d` between).
 * Does not detect an ancestor's `perspective()` projecting a `preserve-3d`
 * child.
 */
const reportProjection = (chain: readonly Layer[]): void => {
  let turnedBelow = false;
  for (const { style, matrix } of chain) {
    if (bendsThePlane(matrix)) {
      reportProjected("transform", style.transform);
    }
    if (turnedBelow && isSet(style.perspective)) {
      reportProjected("perspective", style.perspective);
    }
    turnedBelow =
      (turnedBelow && style.transformStyle === "preserve-3d") ||
      leavesThePlane(matrix);
  }
};

/**
 * Whether this transform is projective over the element's plane.
 *
 * For a point `(x, y, 0)`, `w = m14·x + m24·y + m44`; it varies only if
 * `m14` or `m24` is nonzero.
 */
const bendsThePlane = (matrix: DOMMatrix | undefined): boolean =>
  matrix !== undefined && (matrix.m14 !== 0 || matrix.m24 !== 0);

/**
 * Whether this transform moves the element's plane out of `z = 0`. For a
 * point `(x, y, 0)`, `z = m13·x + m23·y + m43`.
 */
const leavesThePlane = (matrix: DOMMatrix | undefined): boolean =>
  matrix !== undefined &&
  (matrix.m13 !== 0 || matrix.m23 !== 0 || matrix.m43 !== 0);

/** Warns once that a window is drawn through a projection. */
const reportProjected = (property: string, computed: string): void => {
  report(
    `${property}: ${computed}`,
    `cannot invert ${property} ${JSON.stringify(computed)}; a perspective ` +
      `projects this window, which no affine can express, so a pointer over ` +
      `it is mapped as if the window were flat`,
  );
};

// Measurement runs on every pointer move, so each warning is logged once.
// The set is capped because an animated value yields a new key every frame.
const REPORT_LIMIT = 32;
const reported = new Set<string>();

/**
 * Warns once that a CSS value could not be read.
 *
 * The console is the only way to tell the CSS author that clicks will be
 * mapped wrongly.
 */
const reportUnreadable = (property: string, computed: string): void => {
  report(
    `${property}: ${computed}`,
    `cannot read ${property} ${JSON.stringify(computed)}; ` +
      `a pointer over this window is mapped as if it were not set`,
  );
};

const report = (key: string, message: string): void => {
  if (!reported.has(key) && reported.size < REPORT_LIMIT) {
    reported.add(key);
    // biome-ignore lint/suspicious/noConsole: the only channel to the author
    console.warn(`domicile: ${message}`);
  }
};

// Layout-dependent measurements read 0 before the element has a box.
const firstNonZero = (preferred: number, fallback: number): number =>
  preferred > 0 ? preferred : fallback;

/**
 * The element's own `rotate`, `scale` and `transform`, composed in CSS order.
 *
 * `rotate` and `scale` are not part of computed `transform`, so they are read
 * separately. `translate` is skipped: it does not affect the linear part, and
 * its computed value can keep percentages that `DOMMatrix` cannot parse.
 *
 * Returns the full 4x4 so {@link reportProjection} can detect 3D effects.
 * Returns `undefined` where `DOMMatrix` is missing (no layout, so identity).
 */
const readElementTransform = (
  style: CSSStyleDeclaration,
): DOMMatrix | undefined => {
  if (typeof DOMMatrix === "undefined") {
    return undefined;
  }
  const parts = [
    asRotate(style.rotate),
    asScale(style.scale),
    isSet(style.transform) ? style.transform : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) {
    return undefined;
  }
  // Multiplied one at a time because happy-dom (used by the unit tests) drops
  // earlier functions when a list contains `matrix(...)`.
  return parts.reduce(
    (composed, part) => composed.multiply(new DOMMatrix(part)),
    new DOMMatrix(),
  );
};

/**
 * The 2D part of a transform. Matches what CSS draws for a 3D transform with
 * no perspective; {@link reportProjection} warns when there is one.
 */
const linearPart = (matrix: DOMMatrix | undefined): Matrix =>
  matrix === undefined
    ? IDENTITY
    : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];

/**
 * Converts computed `rotate` to a transform function.
 *
 * Handles an angle, an axis keyword plus angle, and an axis vector plus
 * angle. The last two need `rotate3d`. 3D rotations are kept because their 2D
 * part matches what CSS draws without perspective.
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
 * Converts computed `scale` to a transform function; three components use
 * `scale3d`.
 *
 * Passed verbatim: unlike `translate`, computed `scale` never keeps
 * percentages (`scale: 50%` computes to `0.5` in Chromium).
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

// Computed `rotate` and `scale` are space-separated lists like `2 3`.
const components = (value: string | undefined): string[] =>
  isSet(value) ? value.trim().split(/\s+/) : [];

// `none` is the initial value; an unresolved style reads empty.
const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "" && value !== "none";

// Warns about an unhandled value rather than silently ignoring it.
const unreadable = (property: string, value: string | undefined): undefined => {
  reportUnreadable(property, value ?? "");
  return undefined;
};
