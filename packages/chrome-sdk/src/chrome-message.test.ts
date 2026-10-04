import { describe, expect, it } from "bun:test";

import { helloMessage, setDevicePixelRatioMessage } from "./chrome-message";
import { PROTOCOL_VERSION } from "./protocol";

describe("the chrome->host messages the harness still writes", () => {
  it("match the domicile-protocol wire shape", () => {
    expect(helloMessage(2)).toEqual({ protocol_version: 2, type: "hello" });
    expect(setDevicePixelRatioMessage(2)).toEqual({
      ratio: 2,
      type: "set_device_pixel_ratio",
    });
  });

  it("shakes hands at this build's version unless told otherwise", () => {
    // `negotiate` requires equal versions. A wrong default would make harness
    // failures look like compositor bugs.
    expect(helloMessage()).toEqual({
      protocol_version: PROTOCOL_VERSION,
      type: "hello",
    });
  });
});
