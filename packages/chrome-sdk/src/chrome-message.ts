// Builders for the chrome->host messages defined in domicile-protocol. These
// produce plain JSON objects in the exact wire shape the Rust host expects
// (snake_case keys, `type` discriminant). Kept as pure functions so they are
// trivially testable and reusable by the bridge and the custom elements.

import type { Matrix } from "./matrix";
import { PROTOCOL_VERSION } from "./protocol";

/** The on-screen geometry of an `<domicile-app>`, as the host needs it. */
export type Placement = {
  appId: string;
  size: readonly [width: number, height: number];
  transform: Matrix;
  zIndex?: number;
  visible?: boolean;
};

export type ChromeMessage =
  | ReturnType<typeof helloMessage>
  | ReturnType<typeof placePortalMessage>
  | ReturnType<typeof removePortalMessage>
  | ReturnType<typeof focusAppMessage>
  | ReturnType<typeof focusChromeMessage>
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
}: Placement) => {
  if (appId.length === 0) {
    throw new TypeError("placePortal: appId must be a non-empty string");
  }
  return {
    app_id: appId,
    size,
    transform,
    type: "place_portal",
    visible,
    z_index: zIndex,
  } as const;
};

export const removePortalMessage = (appId: string) =>
  ({ app_id: appId, type: "remove_portal" }) as const;

export const focusAppMessage = (appId: string) =>
  ({ app_id: appId, type: "focus_app" }) as const;

export const focusChromeMessage = () => ({ type: "focus_chrome" }) as const;

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

export const pointerAxisMessage = (appId: string, dx: number, dy: number) =>
  ({ app_id: appId, dx, dy, type: "pointer_axis" }) as const;

export const keyMessage = (appId: string, keycode: number, pressed: boolean) =>
  ({ app_id: appId, keycode, pressed, type: "key" }) as const;
