import { describe, expect, it } from "bun:test";

import { helloMessage, setDevicePixelRatioMessage } from "./chrome-message";
import { PROTOCOL_VERSION } from "./protocol";

describe("the chrome->host messages the harness still writes", () => {
  it("match the domicile-protocol wire shape", () => {
    // The whole of what a headless chrome says: it shakes hands, and it
    // reports whatever density the calling script wants to test with. Nothing
    // else here has a writer since the page moved to `navigator.domicile`.
    expect(helloMessage(2)).toEqual({ protocol_version: 2, type: "hello" });
    expect(setDevicePixelRatioMessage(2)).toEqual({
      ratio: 2,
      type: "set_device_pixel_ratio",
    });
  });

  it("shakes hands at this build's version unless told otherwise", () => {
    // `negotiate` requires the two numbers to be equal — a chrome that says 7
    // to a host speaking 8 gets no `welcome`, and everything it sends
    // afterwards is dropped. A default that had drifted from the constant
    // would make the harness fail in a way that reads as the compositor's bug.
    expect(helloMessage()).toEqual({
      protocol_version: PROTOCOL_VERSION,
      type: "hello",
    });
  });
});
