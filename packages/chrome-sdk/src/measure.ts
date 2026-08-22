// How the chrome reports an `<domicile-app>`'s on-screen box to the host.

import { elementToScreen } from "./element-transform";
import type { Matrix } from "./matrix";
import { accumulate, IDENTITY } from "./matrix";
import type { Shadow } from "./shadow";
import { parseShadow, ShadowKind } from "./shadow";
import type { Unsupported } from "./unsupported";
import { unsupportedEffects } from "./unsupported";

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
  /** Whether a pointer over this window belongs to it. */
  takesPointer: boolean;
  /** The first drawable `box-shadow`, if the element has one. */
  shadow: Shadow | undefined;
  /**
   * Whether the compositor can draw this window from the client's own buffer.
   *
   * False when the element is styled in a way its shaders have no answer for.
   * That window goes back down the copy path — read off the GPU and drawn by
   * the engine — which is slow and correct rather than fast and wrong. One
   * window, not the desktop: a blur on one app costs that app and nothing
   * else.
   */
  native: boolean;
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
 *   flattened. The window still reports `native: true` either way, because
 *   `unsupportedEffects` reads only the element's *own* style, so nothing
 *   sends the wrong case down the copy path where it would be drawn
 *   correctly.
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
  const undrawable = unsupportedEffects(style);
  reportUnsupported(undrawable);
  return {
    cornerRadius: readCornerRadius(style),
    // Anything on that list at all means the compositor's picture would differ
    // from the page's, so the engine draws this one instead.
    native: undrawable.length === 0,
    opacity: readOpacity(style),
    shadow: readShadow(style),
    size,
    takesPointer: takesThePointer(style),
    transform: elementToScreen({
      box,
      linear: chainToScreen(element, style),
      size,
    }),
    visible: isVisible(style, size),
    zIndex: readZIndex(style),
  };
};

/**
 * The linear part of everything between this element's own pixels and the
 * screen: its transform, then each ancestor's, outermost last.
 *
 * An ancestor that rotates or skews used to be missed entirely, because
 * `getBoundingClientRect` reports only an axis-aligned box and the element's
 * own transform cannot explain a box that a *parent* turned. A window inside a
 * rotated container therefore stayed square while the page around it turned.
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
 * `activeMeasure`, which `placement-timing` does not count. So the reported
 * placement cost is a floor rather than the whole of it, and a page deep
 * enough for this to matter would show it as pointer latency rather than in
 * that line. The alternative is a window that does not follow the page, which
 * is not a trade.
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
 * where something ends up on screen. A `<domicile-app>` is a custom element,
 * so a chrome that puts one in a shadow tree — or slots one — is not exotic.
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
 * `border-radius` as one number of pixels.
 *
 * The compositor applies a single radius to all four corners — that is what its
 * shader can do without knowing which way up a client's buffer is — so an
 * element with four different ones reports the first, which is the one it set if
 * it set one at all.
 *
 * Only an absolute length survives this. A radius in `%` keeps its `%` in the
 * computed value — `getComputedStyle` resolves it against nothing — so `50%`
 * arrives here as the string `"50%"` and leaves as fifty pixels. So does the
 * two-axis `10px / 20px` form, whose vertical radius is simply dropped.
 * `unsupportedEffects` reports both, because a window drawn that way looks
 * deliberate rather than broken.
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
      // Not dropped: `unsupportedEffects` names this same value, so the window
      // has gone to the engine and the engine casts the shadow.
      reportUnreadable(
        "box-shadow",
        computed,
        "this window is copied frame by frame instead, where the engine draws it",
      );
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
 *
 * The consequence is the caller's to state because it is not the same one
 * every time. An unreadable `box-shadow` hands the window to the engine, which
 * draws the shadow perfectly; an unreadable `rotate` does not, and that window
 * really is drawn without it. One sentence for both would be wrong for one of
 * them, and an author told their shadow was dropped goes looking for a bug in
 * a window that has the shadow.
 */
const reportUnreadable = (
  property: string,
  computed: string,
  consequence: string,
): void => {
  report(
    `${property}: ${computed}`,
    `cannot read ${property} ${JSON.stringify(computed)}; ${consequence}`,
  );
};

/**
 * Say, once, that a style costs this window the native path.
 *
 * A different sentence from `reportUnreadable`, because they are different
 * news: one says the SDK failed on syntax that is valid CSS, which is a bug
 * worth reporting upstream, and this one says the compositor's shaders have no
 * counterpart for an effect, which is not. Collapsing them would tell an
 * author their `rotate` was a deliberate omission when in fact it fell over.
 *
 * The window still looks right — the engine draws it, and the engine can draw
 * anything. What it costs is a readback and a socket hop per frame, for this
 * window alone, which is a thing worth knowing when a stylesheet quietly puts
 * every window on the desktop there.
 *
 * Keyed on the property alone rather than on the value: a `transition` on
 * `filter` mints a new computed value every frame, and keying on it would burn
 * the whole bound inside a second and silence everything after it.
 */
const reportUndrawable = (property: string, computed: string): void => {
  report(
    property,
    `cannot draw ${property} ${JSON.stringify(computed)} in the compositor; ` +
      `this window is copied frame by frame instead, which is slower`,
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
 * Say, once each, what about this element took it off the native path.
 *
 * Not a warning that anything is wrong: the window is drawn exactly as the CSS
 * asks. It is the bill. A single rule in a stylesheet can move every window on
 * the desktop onto the copy path, and the only symptom of that is that the
 * desktop got slower.
 */
const reportUnsupported = (undrawable: Unsupported[]): void => {
  for (const { property, value } of undrawable) {
    reportUndrawable(property, value);
  }
};

/**
 * Whether the compositor should draw this window at all.
 *
 * A size of nothing is the tabbed case: a hidden element has no box, and a
 * portal with no box is one the host stops compositing.
 *
 * `visibility: hidden` — or `collapse` — is the other way to mean it, and it
 * is the dangerous one: it *keeps* the layout box, so the element still measures as a size and
 * every other signal says to draw. Reading only the size shows a window the
 * page asked to hide, which is a worse disagreement than dropping an effect:
 * the window is not merely wrong, it is there at all.
 *
 * Absent is not hidden. An unresolved `visibility` would otherwise take every
 * window off the stage in a DOM implementation that computes nothing.
 */
/**
 * Whether a pointer over this element belongs to it.
 *
 * The compositor routes the pointer by hit-testing a window's rectangle, and a
 * rectangle cannot see that the engine painted a menu, a dialog or a browser
 * tab over it. Without this such a window swallows every click meant for what
 * covers it — including the click that would have handed the keyboard back to
 * the chrome, which is one the chrome has to receive, so there is no way out
 * of it either.
 *
 * `pointer-events` because its *meaning* already matches and it is vocabulary
 * a chrome author knows — not because a page already carries the signal. It
 * does not: the engine hit-tests its own stacking order correctly and has no
 * reason to mark anything, so a chrome that paints over a window has to write
 * a rule it would otherwise never write, and forgetting it is silent.
 *
 * Inherited, which is the part that surprises people and is usually what you
 * want: a `<domicile-app>` inside a container the chrome made inert computes
 * `none` itself and is reported inert with it.
 *
 * All-or-nothing per window, because `pointer-events` is per element. A menu
 * covering one corner of a window makes the *whole* window unclickable rather
 * than that corner — the right trade for a dropdown with a backdrop over it,
 * the wrong one for a popover the user is meant to keep working around. There
 * is no partial-coverage answer available from this signal.
 *
 * `opacity: 0` is not this. A transparent element still hit-tests in the DOM
 * and still reports as taking the pointer, which matches CSS and is what an
 * invisible-but-live window should do; a chrome that wants a faded-out window
 * to stop taking clicks has to say `pointer-events: none` as well.
 *
 * `none` is its only value that means "not this element": the SVG-shaped ones
 * narrow *where on* an element the pointer lands, and a window is not an SVG
 * shape. An unreadable value takes the pointer, for the same reason an
 * unreadable opacity is opaque — a window nobody can click is a worse failure
 * than one that ignores a style, and the two are indistinguishable from
 * outside.
 */
const takesThePointer = (style: CSSStyleDeclaration): boolean =>
  style.pointerEvents !== "none";

const isVisible = (
  style: CSSStyleDeclaration,
  [width, height]: readonly [number, number],
): boolean => width > 0 && height > 0 && !HIDDEN.has(style.visibility);

// `collapse` is the third value, and on anything that is not a table row or
// column it means `hidden` — which a window never is. It keeps its box too, so
// it lands in exactly the state this guards against.
const HIDDEN = new Set(["collapse", "hidden"]);

const finiteOrZero = (value: number): number =>
  Number.isFinite(value) ? Math.max(value, 0) : 0;

// Layout-dependent measurements read 0 before the element has a box; the
// caller wants the first source that actually produced one.
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
// the same reason an unreadable shadow is: a window that quietly ignores a
// style it was given is the failure nobody can debug.
// The transform properties, where unreadable really does mean the window is
// drawn without it: nothing here takes it off the native path, because the
// same matrix is what `surfaceLocal` inverts to map a click. A window handed
// to the engine for this would look right and still be unclickable.
const unreadable = (property: string, value: string | undefined): undefined => {
  reportUnreadable(property, value ?? "", "this window is drawn without it");
  return undefined;
};

// `z-index: auto` parses to NaN, which the host reads as the default layer.
const readZIndex = (style: CSSStyleDeclaration): number => {
  const zIndex = Number.parseInt(style.zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
};
