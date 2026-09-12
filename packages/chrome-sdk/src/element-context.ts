// What the chrome bound the SDK with, and which app has the keyboard.
//
// The input routing and the size pass are installed on `document` once, at
// startup, and they outlive any particular client: `registerElements` binds a
// domicile client (and optionally a measurement strategy and a frame source)
// into the one cell below, and everything it installs reads that cell at dispatch
// rather than closing over what it was handed. So a rebind reaches listeners that
// are already registered, and tests bind their own to inject a double — which is
// why the setter is exported.
//
// This used to exist because a custom element is constructed by the DOM, which
// hands it nothing, so `<domicile-app>` could not take its collaborators as
// constructor arguments the way the rest of the SDK does. The element is the
// engine's now and there is nothing to construct; what is left is the reason
// above, which is the one that outlived it.

import type { DomicileClient } from "./domicile-client";
import type { Measure } from "./measure";
import { defaultMeasure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { defaultObservePlacement } from "./observe-placement";

/**
 * What the SDK was bound with, as one cell that outlives the binding.
 *
 * Handed to everything `registerElements` installs, rather than read back per
 * call. None of it exists before the bind that created it, so for those
 * listeners there is no unbound case to represent, and a client that cannot be
 * `undefined` is a message that cannot be silently dropped.
 *
 * Mutable, and the same object across binds, because those are installed once
 * and a rebind has to reach them.
 */
export type ElementContext = {
  domicile: DomicileClient;
  measure: Measure;
  observePlacement: ObservePlacement;
};

let context: ElementContext | undefined;
let focusedAppId: string | undefined;

export const bindElementContext = (
  domicile: DomicileClient,
  measure: Measure = defaultMeasure,
  observePlacement: ObservePlacement = defaultObservePlacement,
): ElementContext => {
  const bound = context ?? { domicile, measure, observePlacement };
  bound.domicile = domicile;
  bound.measure = measure;
  bound.observePlacement = observePlacement;
  context = bound;
  return bound;
};

/**
 * The app currently receiving keyboard input. Keyboard events are delivered to
 * the document rather than to an element, so the SDK routes them to whichever
 * `<app>` was last reached for.
 */
export const focusedApp = (): string | undefined => focusedAppId;

export const setFocusedApp = (appId: string | undefined): void => {
  focusedAppId = appId;
};
