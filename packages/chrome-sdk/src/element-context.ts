// Page-level state the custom elements read.
//
// A custom element is constructed by the DOM (`document.createElement`), so it
// cannot take its collaborators as constructor arguments the way the rest of
// the SDK does. This module is the seam instead: the chrome binds a bridge (and
// optionally a measurement strategy) once at startup via `registerElements`,
// and the element classes read it from here. Tests bind their own to inject a
// double, which is why the setters are exported.

import type { BridgeClient } from "./bridge";
import type { Measure } from "./measure";
import { defaultMeasure } from "./measure";

let bridge: BridgeClient | undefined;
let measure: Measure = defaultMeasure;
let focusedAppId: string | undefined;

export const bindElementContext = (
  nextBridge: BridgeClient,
  nextMeasure: Measure = defaultMeasure,
): void => {
  bridge = nextBridge;
  measure = nextMeasure;
};

/** The bound bridge, or `undefined` before `registerElements` has run. */
export const activeBridge = (): BridgeClient | undefined => bridge;

export const activeMeasure = (): Measure => measure;

/**
 * The app currently receiving keyboard input. Keyboard events are delivered to
 * the document rather than to an element, so the SDK routes them to whichever
 * `<domicile-app>` was last clicked.
 */
export const focusedApp = (): string | undefined => focusedAppId;

export const setFocusedApp = (appId: string | undefined): void => {
  focusedAppId = appId;
};
