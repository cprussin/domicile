// Telling the host what resolution to configure each client at.
//
// The page can resize a window without any of the chrome's code running — a
// layout change above it, a transition, a class toggle — and a client left at
// its old resolution is stretched into the new box until something else happens
// to it. So the size follows the box rather than being reported once, which is
// one pass over every `<app>` on the page per animation frame.
//
// One pass rather than one loop per element, because the tag is the engine's and
// there is no `connectedCallback` to subscribe from. What replaces it is a
// `querySelectorAll` per frame: a tag selector against Blink's own tag cache,
// against a `getBoundingClientRect` and a `getComputedStyle` per window that the
// measurement already costs. The pass runs for the life of the page rather than
// starting with the first window and stopping with the last, which is what an
// element that followed its own box could do; an empty page costs the walk and
// nothing else.
//
// THIS WHOLE MODULE IS REDUNDANT ON THE FORKED ENGINE, and deliberately still
// here. `LayoutAppSurface::UpdateAfterLayout` reports the pixel-snapped box to
// `HTMLAppElement::SurfaceBoxChanged`, which re-embeds at the new size, and
// `ExternalSurfaceProvider::Embed` carries that size to the compositor as an
// `xdg_toplevel.configure` — so the engine already answers this question with
// the box it actually laid out. What is missing is evidence: nothing has shown a
// real client's window through the native `<app>`, where the `<canvas>` path
// this replaces has run on a desktop. Deleting the chrome's half is the step
// with the measurements behind it, and it is its own change. See ROADMAP.md.

import { APP_TAG_NAME } from "./app-element";
import type { ElementContext } from "./element-context";
import { placementTiming } from "./placement-timing";

/**
 * The last instruction sent for each element, so a measurement that changed
 * nothing costs nothing.
 *
 * Keyed on the element and holding the app as well as the size, because what
 * identifies the instruction is what it would *say*, and the app it is about is
 * half of that. Keyed on the size alone, an element that swapped `app-id` while
 * keeping its box would leave the new client never configured, drawing at
 * whatever size the previous one asked for.
 *
 * A `WeakMap` because the keys are elements a shell takes down whenever it
 * likes, and a page open for a day would otherwise hold every window it ever
 * drew.
 */
const reported = new WeakMap<Element, string>();

/** Report every window's box every frame; returns the function that stops. */
export const reportAppSizes = (context: ElementContext): (() => void) =>
  context.observePlacement(() => {
    reportEveryAppSize(context);
  });

/**
 * One pass over the windows on the page.
 *
 * A window that cannot be measured costs that window and no other. The throw is
 * not hypothetical — `new DOMMatrix(…)` throws on a computed value the SDK
 * cannot parse, and it has — and a desktop where the second window stops being
 * configured because the first has bad CSS is not a trade anyone made. So the
 * failures are collected and raised after every window has had its turn, which
 * is also what lets `observePlacement` book the next frame before it sees them.
 *
 * An array rather than a single slot because `throw undefined` is legal, so one
 * slot could not tell "nobody threw" from "somebody threw `undefined`" without a
 * second flag beside it. All of them are raised rather than the first, because
 * keeping only the first would hide the second window's failure for the life of
 * the page while reporting the first sixty times a second.
 */
const reportEveryAppSize = (context: ElementContext): void => {
  const failures: unknown[] = [];
  for (const element of document.querySelectorAll(APP_TAG_NAME)) {
    try {
      reportOneAppSize(context, element);
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  } else if (failures.length > 1) {
    throw new AggregateError(failures, "windows that could not be measured");
  }
};

/**
 * Tell the host what resolution to configure this element's client at.
 *
 * Priced whether or not anything is sent, and whether or not it finishes. What
 * costs is the measuring, and the measuring happens every frame for every
 * window — see `placement-timing`.
 *
 * In a `finally` because a window that cannot be measured has already paid for
 * the attempt: `readElementTransform` throws on a computed value it cannot
 * parse, from *after* the layout read, and the pass keeps calling it every frame
 * for the life of the page. Priced only on success, that window would cost the
 * desktop sixty measurements a second and contribute nothing to the number — so
 * the desktop where this matters most is the one it would under-report hardest.
 * Nothing is caught here: the throw still reaches the pass, which collects it.
 */
const reportOneAppSize = (
  context: ElementContext,
  element: HTMLAppElement,
): void => {
  const started = performance.now();
  try {
    const appId = element.getAttribute("app-id");
    if (appId !== null) {
      const { size, visible } = context.measure(element);
      // The client renders at its own resolution: without this it would keep
      // drawing at the old size and be stretched into the new box. An element
      // with no box (a hidden tab) has no size to render at, and configuring the
      // client to nothing would make it redraw on every tab switch.
      //
      // Measuring happens on every animation frame, so most of the time this is
      // the same window at the same size and there is nothing to say — which
      // matters here more than anywhere, because a client redraws whenever it is
      // configured.
      const instruction = JSON.stringify({ appId, size });
      if (visible && instruction !== reported.get(element)) {
        // Recorded after the send, not before: a throw on the way out would
        // otherwise leave the SDK sure it had reported a size the host never
        // received, and nothing would send it again until the window changed
        // size.
        context.domicile.resizeApp(appId, size);
        reported.set(element, instruction);
      }
    }
  } finally {
    placementTiming.record(performance.now() - started);
  }
};
