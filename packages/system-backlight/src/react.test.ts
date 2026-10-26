import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskBacklight, deskBacklightHardware } from "./react";

describe("the desk's backlight watches", () => {
  it("are one per desktop", () => {
    const { domicile } = new FakeDomicileHost();

    expect(deskBacklight(domicile)).toBe(deskBacklight(domicile));
    expect(deskBacklightHardware(domicile)).toBe(
      deskBacklightHardware(domicile),
    );
  });
});
