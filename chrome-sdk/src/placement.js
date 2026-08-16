// Builders for the chrome->host messages defined in domicile-protocol. These produce
// plain JSON objects in the exact wire shape the Rust host expects (snake_case
// keys, `type` discriminant). Kept as pure functions so they are trivially
// testable and reusable by the bridge and the custom elements.

export const PROTOCOL_VERSION = 1;

/**
 * Report the on-screen placement of an `<app>` element.
 * @param {{appId: string, size: [number, number], transform: number[],
 *          zIndex?: number, visible?: boolean}} p
 */
export function placePortalMessage({ appId, size, transform, zIndex = 0, visible = true }) {
  if (typeof appId !== "string" || appId.length === 0) {
    throw new TypeError("placePortal: appId must be a non-empty string");
  }
  if (!Array.isArray(size) || size.length !== 2) {
    throw new TypeError("placePortal: size must be [width, height]");
  }
  if (!Array.isArray(transform) || transform.length !== 6) {
    throw new TypeError("placePortal: transform must be a 6-element affine matrix");
  }
  return {
    type: "place_portal",
    app_id: appId,
    transform,
    size,
    z_index: zIndex,
    visible,
  };
}

export function removePortalMessage(appId) {
  return { type: "remove_portal", app_id: appId };
}

export function focusAppMessage(appId) {
  return { type: "focus_app", app_id: appId };
}

export function focusChromeMessage() {
  return { type: "focus_chrome" };
}

/** Ask the compositor to spawn a client process (argv). */
export function spawnMessage(command) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new TypeError("spawn: command must be a non-empty argv array");
  }
  return { type: "spawn", command };
}

export function helloMessage(protocolVersion = PROTOCOL_VERSION) {
  return { type: "hello", protocol_version: protocolVersion };
}

// ---- input forwarding (surface-local coords; evdev keycodes) --------------

export function pointerMotionMessage(appId, x, y) {
  return { type: "pointer_motion", app_id: appId, x, y };
}

export function pointerLeaveMessage(appId) {
  return { type: "pointer_leave", app_id: appId };
}

export function pointerButtonMessage(appId, button, pressed) {
  return { type: "pointer_button", app_id: appId, button, pressed };
}

export function pointerAxisMessage(appId, dx, dy) {
  return { type: "pointer_axis", app_id: appId, dx, dy };
}

export function keyMessage(appId, keycode, pressed) {
  return { type: "key", app_id: appId, keycode, pressed };
}
