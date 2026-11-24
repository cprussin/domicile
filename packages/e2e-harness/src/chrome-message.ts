// Builders for the chrome->host messages `@domicile-desktop/e2e-harness`
// writes.
//
// Pages do not use these: a shell calls the `DomicileHost` it is handed and
// the browser process writes the wire. The harness connects to the compositor
// socket directly to test the compositor. Shapes match `domicile-protocol`.

import { PROTOCOL_VERSION } from "./protocol";

/** A hello from an official engine, so the compositor posts no warning. */
export const helloMessage = (protocolVersion: number = PROTOCOL_VERSION) =>
  ({
    checked: false,
    protocol_version: protocolVersion,
    type: "hello",
  }) as const;

/**
 * Report the chrome's device pixel ratio. The compositor uses it as the output
 * scale so clients render at native resolution.
 */
export const setDevicePixelRatioMessage = (ratio: number) =>
  ({ ratio, type: "set_device_pixel_ratio" }) as const;
