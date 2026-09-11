// Builders for the two chrome->host messages that still have a writer.
//
// **A page does not speak this wire any more.** Under the fork a shell calls
// methods on `navigator.domicile` and the browser process serialises them, so
// the eleven other builders that used to live here — resize, focus, close,
// spawn, grab, and the five input forwards — had exactly one caller between
// them and it was `DomicileClient.send`, which is gone. They went with it
// rather than staying as a second, unexercised copy of a wire shape that can only
// drift from the one the browser process actually writes.
//
// What is left has a caller that is not a page: `@domicile/e2e-harness` is a
// headless stand-in for a chrome that connects to the compositor's own socket
// and speaks the JSON directly, because the thing it is there to assert is
// what the *compositor* does. It shakes hands and it reports a density, and
// that is the whole of what it says.
//
// The shapes are `domicile-protocol`'s, exactly: snake_case keys and a `type`
// discriminant. Kept as pure functions so they are trivially testable.

import { PROTOCOL_VERSION } from "./protocol";

export const helloMessage = (protocolVersion: number = PROTOCOL_VERSION) =>
  ({ protocol_version: protocolVersion, type: "hello" }) as const;

/**
 * Report how many physical pixels the chrome paints per CSS pixel. The
 * compositor advertises it as the output scale, which is what makes a client
 * draw at the display's real resolution rather than be stretched over it.
 */
export const setDevicePixelRatioMessage = (ratio: number) =>
  ({ ratio, type: "set_device_pixel_ratio" }) as const;
