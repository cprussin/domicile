// What the chrome has to read off an `<app>`'s box.
//
// Two things need it, and neither is where the window goes: the size is the
// resolution the client is configured at, and the element->screen affine is
// what a pointer position inverts through to reach the client's surface. How
// the window is drawn is CSS on this element and never travels.

import { elementToScreen } from "./element-transform";
import type { Matrix } from "./matrix";
import { accumulate, IDENTITY } from "./matrix";

export type Measurement = {
  size: readonly [width: number, height: number];
  transform: Matrix;
  /** Whether this element has a box the client can be sized to. */
  visible: boolean;
};

export type Measure = (element: HTMLElement) => Measurement;

/**
 * Default DOM measurement: element-local size plus an element->screen affine.
 *
 * The affine composes the CSS transforms between this element and the screen
 * — its own and each ancestor's along the flat tree — with where
 * `getBoundingClientRect` puts the result, so an app maps correctly in both
 * directions through a page that rotated, scaled or skewed it. The engine
 * integration, which knows each layer's transform outright, replaces this when
 * running inside the compositor.
 *
 * What it does not follow, and what that costs:
 *
 * - A **3D or perspective** ancestor, in the cases where flattening is not
 *   what the engine does. Only the 2D part of each ancestor's transform is
 *   composed. That is the right answer when the ancestor flattens — the
 *   default — and the wrong one under `transform-style: preserve-3d` or a
 *   `perspective` above it, where the descendant is projected rather than
 *   flattened.
 * - **`zoom`** on the element or any ancestor. It scales the box but is not a
 *   transform, so the linear part misses it while `getBoundingClientRect`
 *   already includes it — the two disagree by exactly the zoom factor.
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
    visible: isVisible(style, size),
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
 * This is a `getComputedStyle` and a `matches` per ancestor, on a path that
 * runs per window per animation frame — and again per `pointermove`, through
 * the bound `measure`, which `placement-timing` does not count. So the reported
 * cost is a floor rather than the whole of it, and a page deep enough for this
 * to matter would show it as pointer latency rather than in that line. The
 * alternative is a click that lands somewhere the user did not press, which is
 * not a trade.
 */
const chainToScreen = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
): Matrix => {
  const chain = [readElementTransform(style)];
  // Nothing above a top-layer element contributes, so the walk does not start.
  if (!inTopLayer(element)) {
    for (
      let above = paintedInside(element);
      above !== undefined;
      above = paintedInside(above)
    ) {
      chain.push(readElementTransform(getComputedStyle(above)));
      // Its own transform applies — the element is inside it — but its
      // ancestors' do not, because it is painted outside them.
      if (inTopLayer(above)) {
        break;
      }
    }
  }
  return accumulate(chain);
};

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

// Measurement runs on every frame, so the same unreadable value would
// otherwise be reported many times a second.
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

/**
 * Whether this element has a box a client can be configured to.
 *
 * A size of nothing is the tabbed case: a hidden element has no box, and a
 * client configured to nothing would redraw on every tab switch.
 *
 * `visibility: hidden` — or `collapse` — is the other way to mean it, and it
 * is the dangerous one: it *keeps* the layout box, so the element still
 * measures as a size while the page has said it is not to be seen. A window
 * the user cannot see is not one to make redraw.
 *
 * Absent is not hidden. An unresolved `visibility` would otherwise leave every
 * client unconfigured in a DOM implementation that computes nothing.
 */
const isVisible = (
  style: CSSStyleDeclaration,
  [width, height]: readonly [number, number],
): boolean => width > 0 && height > 0 && !HIDDEN.has(style.visibility);

// `collapse` is the third value, and on anything that is not a table row or
// column it means `hidden` — which a window never is. It keeps its box too, so
// it lands in exactly the state this guards against.
const HIDDEN = new Set(["collapse", "hidden"]);

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
// the same reason an unreadable transform is: a window whose clicks quietly
// stop matching what the page drew is the failure nobody can debug.
const unreadable = (property: string, value: string | undefined): undefined => {
  reportUnreadable(property, value ?? "");
  return undefined;
};
