import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskBattery, deskBatteryHardware } from "./react";

describe("the desk's battery watches", () => {
  it("are one per desktop", () => {
    const { domicile } = new FakeDomicileHost();

    expect(deskBattery(domicile)).toBe(deskBattery(domicile));
    expect(deskBatteryHardware(domicile)).toBe(deskBatteryHardware(domicile));
  });
});
