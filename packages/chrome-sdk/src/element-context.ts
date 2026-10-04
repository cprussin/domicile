// The host the SDK is bound to, and which app has the keyboard.
//
// Input listeners are installed on `document` once and read this state at
// dispatch time, so a rebind reaches listeners that already exist. Tests bind
// their own host to inject a double.

import type { DomicileHost } from "./domicile-host";
import type { Measure } from "./measure";
import { defaultMeasure } from "./measure";

/** What input routing uses of the desktop. */
export type InputHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "focusApp"
  | "focusChrome"
  | "focusedWindow"
  | "key"
  | "pointerAxis"
  | "pointerButton"
  | "pointerLeave"
  | "pointerMotion"
  | "windows"
>;

/**
 * The host and measurement strategy the SDK is bound to.
 *
 * Mutable and shared across binds: listeners are installed once, so a rebind
 * must update the object they already hold.
 */
export type ElementContext = {
  domicile: InputHost;
  measure: Measure;
};

let context: ElementContext | undefined;
let focusedAppId: string | undefined;

export const bindElementContext = (
  domicile: InputHost,
  measure: Measure = defaultMeasure,
): ElementContext => {
  const bound = context ?? { domicile, measure };
  bound.domicile = domicile;
  bound.measure = measure;
  context = bound;
  return bound;
};

/**
 * The app that receives keyboard input.
 *
 * Keyboard events arrive at the document, not at an element, so the SDK
 * tracks the target itself.
 */
export const focusedApp = (): string | undefined => focusedAppId;

export const setFocusedApp = (appId: string | undefined): void => {
  focusedAppId = appId;
};
