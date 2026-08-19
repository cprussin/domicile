// Builders for the chrome->host messages defined in domicile-protocol. These
// produce plain JSON objects in the exact wire shape the Rust host expects
// (snake_case keys, `type` discriminant). Kept as pure functions so they are
// trivially testable and reusable by the bridge and the custom elements.

import type { Matrix } from "./matrix";
import { PROTOCOL_VERSION } from "./protocol";
import type { AxisDelta } from "./wheel-axis";

/** The on-screen geometry of an `<domicile-app>`, as the host needs it. */
export type Placement = {
  appId: string;
  size: readonly [width: number, height: number];
  transform: Matrix;
  zIndex?: number;
  visible?: boolean;
  /** `border-radius` in logical pixels. Square if omitted. */
  cornerRadius?: number;
  /** `opacity`, 0 to 1. Opaque if omitted — never invisible. */
  opacity?: number;
};

export type ChromeMessage =
  | ReturnType<typeof helloMessage>
  | ReturnType<typeof placePortalMessage>
  | ReturnType<typeof removePortalMessage>
  | ReturnType<typeof resizeAppMessage>
  | ReturnType<typeof setDevicePixelRatioMessage>
  | ReturnType<typeof focusAppMessage>
  | ReturnType<typeof focusChromeMessage>
  | ReturnType<typeof grabShortcutMessage>
  | ReturnType<typeof spawnMessage>
  | ReturnType<typeof pointerMotionMessage>
  | ReturnType<typeof pointerLeaveMessage>
  | ReturnType<typeof pointerButtonMessage>
  | ReturnType<typeof pointerAxisMessage>
  | ReturnType<typeof keyMessage>;

export const helloMessage = (protocolVersion: number = PROTOCOL_VERSION) =>
  ({ protocol_version: protocolVersion, type: "hello" }) as const;

/** Report the on-screen placement of an `<domicile-app>` element. */
export const placePortalMessage = ({
  appId,
  size,
  transform,
  zIndex = 0,
  visible = true,
  cornerRadius = 0,
  // Opaque, never invisible: a window nobody can see is a worse failure than
  // one that ignores a style, and it looks identical to not being drawn.
  opacity = 1,
}: Placement) => {
  if (appId.length === 0) {
    throw new TypeError("placePortal: appId must be a non-empty string");
  }
  return {
    app_id: appId,
    corner_radius: cornerRadius,
    opacity,
    size,
    transform,
    type: "place_portal",
    visible,
    z_index: zIndex,
  } as const;
};

export const removePortalMessage = (appId: string) =>
  ({ app_id: appId, type: "remove_portal" }) as const;

/**
 * Report an `<domicile-app>` element's new laid-out size, so the compositor can
 * configure the client to render at that resolution.
 */
export const resizeAppMessage = (
  appId: string,
  size: readonly [width: number, height: number],
) => {
  if (appId.length === 0) {
    throw new TypeError("resizeApp: appId must be a non-empty string");
  }
  return { app_id: appId, size, type: "resize_app" } as const;
};

/**
 * Report how many physical pixels the chrome paints per CSS pixel. The
 * compositor advertises it as the output scale, which is what makes a client
 * draw at the display's real resolution rather than be stretched over it.
 */
export const setDevicePixelRatioMessage = (ratio: number) =>
  ({ ratio, type: "set_device_pixel_ratio" }) as const;

export const focusAppMessage = (appId: string) =>
  ({ app_id: appId, type: "focus_app" }) as const;

export const focusChromeMessage = () => ({ type: "focus_chrome" }) as const;

/**
 * A key combination the desktop claims for itself.
 *
 * `key` is an evdev keycode, the same numbering {@link keyMessage} forwards in.
 */
export type Shortcut = {
  key: number;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  logo: boolean;
};

/**
 * Claim a combination, so the compositor takes it out of the stream before the
 * focused client is given it.
 *
 * Without this a chrome shortcut only works while the chrome has the keyboard —
 * which is to say, not once a window is on screen, which is exactly when the
 * user wants to open another one.
 */
export const grabShortcutMessage = (shortcut: Shortcut) =>
  ({ shortcut, type: "grab_shortcut" }) as const;

/** Ask the compositor to spawn a client process (argv). */
export const spawnMessage = (command: readonly string[]) => {
  if (command.length === 0) {
    throw new TypeError("spawn: command must be a non-empty argv array");
  }
  return { command, type: "spawn" } as const;
};

// ---- input forwarding (surface-local coords; evdev keycodes) --------------

export const pointerMotionMessage = (appId: string, x: number, y: number) =>
  ({ app_id: appId, type: "pointer_motion", x, y }) as const;

export const pointerLeaveMessage = (appId: string) =>
  ({ app_id: appId, type: "pointer_leave" }) as const;

export const pointerButtonMessage = (
  appId: string,
  button: number,
  pressed: boolean,
) => ({ app_id: appId, button, pressed, type: "pointer_button" }) as const;

export const pointerAxisMessage = (
  appId: string,
  { dx, dy, v120X, v120Y }: AxisDelta,
) =>
  ({
    app_id: appId,
    dx,
    dy,
    type: "pointer_axis",
    v120_x: v120X,
    v120_y: v120Y,
  }) as const;

export const keyMessage = (appId: string, keycode: number, pressed: boolean) =>
  ({ app_id: appId, keycode, pressed, type: "key" }) as const;
