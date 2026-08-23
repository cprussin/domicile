// What the chrome bound the SDK with, and which app has the keyboard.
//
// A custom element is constructed by the DOM (`document.createElement`), so it
// cannot take its collaborators as constructor arguments the way the rest of
// the SDK does. This module is the seam instead: the chrome binds a bridge (and
// optionally a measurement strategy) once at startup via `registerElements`,
// which hands the resulting context to the listeners it installs and to the
// element class it builds. Tests bind their own to inject a double, which is
// why the setter is exported.

import type { BridgeClient } from "./bridge";
import type { Measure } from "./measure";
import { defaultMeasure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { defaultObservePlacement } from "./observe-placement";

/**
 * What the SDK was bound with, as one cell that outlives the binding.
 *
 * Handed to everything `registerElements` builds, rather than read back per
 * call. None of it — the document-level input listeners, the `<domicile-app>`
 * class — exists before the bind that created it, so for them there is no
 * unbound case to represent, and a bridge that cannot be `undefined` is a
 * message that cannot be silently dropped.
 *
 * Mutable, and the same object across binds, because those are built once and
 * a rebind has to reach them.
 */
export type ElementContext = {
  bridge: BridgeClient;
  measure: Measure;
  observePlacement: ObservePlacement;
};

let context: ElementContext | undefined;
let focusedAppId: string | undefined;

export const bindElementContext = (
  bridge: BridgeClient,
  measure: Measure = defaultMeasure,
  observePlacement: ObservePlacement = defaultObservePlacement,
): ElementContext => {
  const bound = context ?? { bridge, measure, observePlacement };
  bound.bridge = bridge;
  bound.measure = measure;
  bound.observePlacement = observePlacement;
  context = bound;
  return bound;
};

/**
 * The app currently receiving keyboard input. Keyboard events are delivered to
 * the document rather than to an element, so the SDK routes them to whichever
 * `<domicile-app>` was last clicked.
 */
export const focusedApp = (): string | undefined => focusedAppId;

export const setFocusedApp = (appId: string | undefined): void => {
  focusedAppId = appId;
};
