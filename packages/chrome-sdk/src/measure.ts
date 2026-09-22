// What the chrome has to read off an `<app>`'s box.
//
// One thing needs it, and it is not where the window goes: a pointer position
// inverts through the element->screen affine to reach the client's surface,
// and the size is what scales it into the client's own pixels. How the window
// is drawn is CSS on this element and never travels, and what resolution the
// client draws at is the engine's to state — an `<app>`'s layout box *is* the
// `xdg_toplevel.configure`.

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
 * The affine composes the CSS transforms between this element and the screen
 * — its own and each ancestor's along the flat tree — with the `zoom` in
 * effect over it and with where `getBoundingClientRect` puts the result, so an
 * app maps correctly in both directions through a page that rotated, scaled,
 * skewed or zoomed it. The engine integration, which knows each layer's
 * transform outright, replaces this when running inside the compositor.
 *
 * What it does not follow, and what that costs:
 *
 * - A **perspective projection**: a `perspective` above a window that has
 *   turned out of its plane, or a `perspective()` in a transform over one.
 *   That is not an affine and no `Matrix` can hold it, so this composes the
 *   flattened 2D part — what CSS itself draws with no perspective in the chain
 *   — and {@link reportProjection} says on the console that a pointer over
 *   that window is mapped as though the projection were not there. Detected
 *   and declared rather than approximated in silence; mapping nothing at all
 *   would be a window that ignores the pointer, which answers the same
 *   question worse.
 * - Anything **between the flat tree and the paint order** that neither
 *   `assignedSlot` nor the shadow host explains.
 *
 * A window painted in the **top layer** — an open `<dialog>` or popover — is
 * handled rather than missed: the walk stops there, because its ancestors'
 * transforms do not apply to it.
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
 * The linear part of everything between this element's own pixels and the
 * screen: its transform, then each ancestor's, outermost last.
 *
 * An ancestor that rotates or skews used to be missed entirely, because
 * `getBoundingClientRect` reports only an axis-aligned box and the element's
 * own transform cannot explain a box that a *parent* turned. A click on a
 * window inside a rotated container therefore reached the client at the
 * coordinate it would have had if nothing had turned.
 *
 * Only the linear part is accumulated, and that is the whole trick. Each
 * transform applies about its own element's `transform-origin`, in its own
 * element's coordinates — so composing them properly would need every layout
 * offset in between. But conjugating by an origin is a *translation*, and a
 * translation does not change a linear part; and `elementToScreen` does not
 * need the translation, because it solves for the one that puts the
 * transformed box's corner where `getBoundingClientRect` says it is. Two
 * affines with the same linear part and the same bounding-box corner are the
 * same affine, so the offsets in between cancel exactly.
 *
 * Element-first, each ancestor after it — the order `accumulate` composes, so
 * an ancestor's transform applies to the result of everything inside it.
 *
 * The zoom multiplies all of it, and it is not part of the chain because it is
 * not a transform — see {@link zoomOver} for which of the two spaces each
 * thing this reads is in.
 *
 * This is a `getComputedStyle` and a `matches` per ancestor, and it runs per
 * `pointermove` over a window — so a page deep enough for this to matter would
 * show it as pointer latency. The alternative is a click that lands somewhere
 * the user did not press, which is not a trade.
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

/** One element on the way to the screen, and what it asked to be drawn as. */
type Layer = {
  style: CSSStyleDeclaration;
  matrix: DOMMatrix | undefined;
};

/** The element and everything it is painted inside, element-first. */
const layersToScreen = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
): Layer[] => {
  const chain = [readLayer(style)];
  // Nothing above a top-layer element contributes, so the walk does not start.
  if (!inTopLayer(element)) {
    for (
      let above = paintedInside(element);
      above !== undefined;
      above = paintedInside(above)
    ) {
      chain.push(readLayer(getComputedStyle(above)));
      // Its own transform applies — the element is inside it — but its
      // ancestors' do not, because it is painted outside them.
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
 * What this element is painted inside, which is not always its parent element.
 *
 * `parentElement` is null at a shadow boundary and points at the *written*
 * parent for slotted content, so both stop or mislead a walk that is asking
 * where something ends up on screen. A chrome that renders its windows from a
 * component library puts one in a shadow tree — or slots one — without thinking
 * about it.
 */
const paintedInside = (element: Element): HTMLElement | undefined => {
  // Absent rather than null in some DOM implementations, so both are "no slot"
  // — reading only one of them stopped the walk at the first element.
  const slot: HTMLSlotElement | null | undefined = element.assignedSlot;
  const parent: Node | null = element.parentNode;
  if (slot !== null && slot !== undefined) {
    // Slotted content is painted where the slot is, not where it is written.
    return slot;
  } else if (parent === null) {
    return undefined;
  } else if (parent instanceof ShadowRoot) {
    // A shadow root is not an element, and what holds it is where its content
    // is drawn.
    return parent.host instanceof HTMLElement ? parent.host : undefined;
  } else {
    return parent instanceof HTMLElement ? parent : undefined;
  }
};

/**
 * Whether this element is painted in the top layer.
 *
 * A modal dialog or an open popover is painted outside its ancestors
 * entirely — their transforms do not apply to it, and walking up as if they
 * did puts the window somewhere the page never drew it. This was right by
 * accident before the walk existed, and the walk is what breaks it.
 *
 * Asked as one selector list, and unguarded. An engine that has never heard of
 * `:popover-open` throws on the whole list rather than on the half it does not
 * know — so swallowing that would report every element as outside the top
 * layer, silently restoring the misplacement this exists to prevent. Louder is
 * better: an engine this cannot ask is one whose answers cannot be trusted.
 */
const inTopLayer = (element: Element): boolean =>
  element.matches(":modal, :popover-open");

/**
 * Every `zoom` between this element's own pixels and the space its transform
 * is written in, as one factor.
 *
 * `zoom` is the one thing that moves and scales a window on screen without
 * being a transform, and it compounds down the tree — so neither an element's
 * own computed `zoom`, which is only its own factor, nor any transform's
 * linear part has the whole of it. `currentCSSZoom` is the engine's own
 * statement of the compounded one, which is the number layout used.
 *
 * It belongs in the affine because it is exactly the factor between the two
 * things measured here, read at the engine's pin rather than assumed:
 * `Element::OffsetWidth` divides the layout box by the element's *effective*
 * zoom (`AdjustForAbsoluteZoom::AdjustLayoutUnit`), so the size is in unzoomed
 * element pixels; `getBoundingClientRect` goes through
 * `AdjustRectMaybeExcludingCSSZoom`, which under `StandardizedBrowserZoom` —
 * stable in the pinned engine — takes only the *browser's* zoom back out, so
 * the box keeps the CSS zoom. A `MouseEvent`'s `clientX` is divided by that
 * same browser factor and no other, so the pointer arrives in the box's space.
 * Unzoomed in, zoomed out, and this is the step between them.
 *
 * Uniform, so where it is multiplied in does not matter: a scalar commutes
 * with every linear part in the chain.
 *
 * Absent in a DOM implementation that lays nothing out, where 1 is right for
 * the same reason a missing `DOMMatrix` means identity — nothing that does no
 * layout has zoomed anything.
 */
const zoomOver = (element: Element): number => {
  const zoom: number | undefined = element.currentCSSZoom;
  return zoom ?? 1;
};

/**
 * Say so when the chain draws this window with a projection, which is not
 * something an affine can be.
 *
 * A perspective divides x and y by a number that varies across the window, so
 * no two corners scale alike — there is no `Matrix` that does that, and
 * composing the 2D part regardless yields a plausible mapping that lands a
 * click where the user did not press. The console is the only channel the SDK
 * has to whoever wrote the CSS, and this is invisible from anywhere else: the
 * engine turns the window exactly as the page asked, and only the coordinate
 * the client is handed disagrees with what the user is looking at.
 *
 * Two shapes reach here. A `perspective()` inside an element's own transform
 * list bends that element's own plane, which is {@link bendsThePlane}. The
 * `perspective` property does it from above instead — it projects its
 * children's transforms — so it matters exactly when something below it has
 * left the plane, and CSS flattens that at every element that is not
 * `preserve-3d`. Hence the walk carries the answer outward rather than asking
 * whether anything anywhere in the chain is 3D: a turn a flat ancestor has
 * already flattened is drawn by the 2D part, and warning about it would cry
 * wolf over the case this gets right.
 *
 * One shape it does not detect, stated rather than hidden: a bare
 * `perspective()` in an *ancestor's* transform list, projecting a turn that
 * `preserve-3d` carried up to it. Both halves are exotic and the pair is
 * rarer still, and detecting it means modeling where each 3D rendering context
 * begins rather than reading one matrix at a time.
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
 * Whether this transform maps the element's own plane projectively rather than
 * affinely — a `perspective()` in its list with something turned behind it.
 *
 * A point of the window is `(x, y, 0)`, and a 4x4 matrix sends its `w` to
 * `m14·x + m24·y + m44`. An affine keeps `w` constant over the plane, so
 * anything that varies it — which is `m14` or `m24`, and only those — divides
 * each corner by a different number.
 */
const bendsThePlane = (matrix: DOMMatrix | undefined): boolean =>
  matrix !== undefined && (matrix.m14 !== 0 || matrix.m24 !== 0);

/**
 * Whether this transform takes the element's plane out of `z = 0`, which is
 * what gives a perspective above it anything to project. The `z` of a point
 * `(x, y, 0)` is `m13·x + m23·y + m43`.
 */
const leavesThePlane = (matrix: DOMMatrix | undefined): boolean =>
  matrix !== undefined &&
  (matrix.m13 !== 0 || matrix.m23 !== 0 || matrix.m43 !== 0);

/**
 * Say so, once, that a window is drawn through a projection this cannot
 * invert. Shares {@link report}'s bounded record with the unreadable values,
 * because it is on the same per-`pointermove` path and would otherwise be said
 * many times a second.
 */
const reportProjected = (property: string, computed: string): void => {
  report(
    `${property}: ${computed}`,
    `cannot invert ${property} ${JSON.stringify(computed)}; a perspective ` +
      `projects this window, which no affine can express, so a pointer over ` +
      `it is mapped as if the window were flat`,
  );
};

// Measurement runs on every pointer move over a window, so the same unreadable
// value would otherwise be reported many times a second.
//
// Bounded, because the key is the whole computed string and a `transition` on
// `rotate` produces a new one every frame. Past the cap the reports stop
// rather than the memory growing: the first few name the syntax at fault,
// which is the whole job, and an unbounded set on a path that runs per frame
// is a worse bug than the one it is reporting.
const REPORT_LIMIT = 32;
const reported = new Set<string>();

/**
 * Say so, once, that an element asked for something this could not read.
 *
 * The console is the only channel the SDK has to whoever wrote the CSS, and
 * this failure is invisible from outside: the engine turns the window exactly
 * as the page asked, and only the surface coordinates a click is mapped to
 * disagree with what the user is looking at.
 *
 * Nothing escalates a value it cannot read, because there is nowhere to
 * escalate to.
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

// Layout-dependent measurements read 0 before the element has a box; the
// caller wants the first source that actually produced one.
const firstNonZero = (preferred: number, fallback: number): number =>
  preferred > 0 ? preferred : fallback;

/**
 * Everything the element does to its own coordinate system, as one matrix.
 *
 * `transform` is not the whole story: `rotate` and `scale` are properties in
 * their own right, and neither appears in the computed `transform`. An element
 * written with them turns or stretches in the page while a reading that took
 * only `transform` maps a click as if it had not — a disagreement with no
 * error anywhere to notice it.
 *
 * CSS applies them in a fixed order — translate, then rotate, then scale, then
 * `transform` — all about the same origin, which is why their linear parts can
 * be composed here at all.
 *
 * `translate` is deliberately absent. It is a pure translation, so it cannot
 * change the linear part, and the position it does contribute is already in the
 * `getBoundingClientRect` that `elementToScreen` derives the offset from — the
 * two cancel exactly. Including it would also break the commonest centering
 * idiom in CSS: computed `translate` keeps its percentages where `transform`
 * resolves them, and a matrix cannot be built from a relative length, so
 * `translate: -50% -50%` threw out of every measurement.
 *
 * The whole 4x4 is kept rather than the six numbers the mapping uses, because
 * the three slots the mapping drops are what say whether dropping them is
 * honest — see {@link reportProjection}.
 *
 * `DOMMatrix` is absent in some non-browser DOM implementations, where no
 * transform is the correct answer: those environments do no layout and so
 * apply no transform either.
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
    // Already a transform list, so it goes in as it stands.
    isSet(style.transform) ? style.transform : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) {
    return undefined;
  }
  // Multiplied one at a time rather than concatenated into a list for
  // `DOMMatrix` to parse. happy-dom's implementation — the one the unit tests
  // run against — lets a `matrix(...)` reset the accumulator, so `scale(2)
  // matrix(...)` silently loses the scale. Chromium composes the list
  // correctly, so this is not a production bug; it is what stops the unit
  // tests measuring a happy-dom artifact instead of the real arithmetic.
  return parts.reduce(
    (composed, part) => composed.multiply(new DOMMatrix(part)),
    new DOMMatrix(),
  );
};

/**
 * The 2D part of a transform: what CSS itself draws for a 3D one with no
 * perspective over it — the drop-z orthographic projection — and the nearest
 * affine to it when there is one, which {@link reportProjection} reports.
 */
const linearPart = (matrix: DOMMatrix | undefined): Matrix =>
  matrix === undefined
    ? IDENTITY
    : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];

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
// the same reason an unreadable transform is: a window whose clicks quietly
// stop matching what the page drew is the failure nobody can debug.
const unreadable = (property: string, value: string | undefined): undefined => {
  reportUnreadable(property, value ?? "");
  return undefined;
};
