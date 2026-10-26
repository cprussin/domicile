import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskBluetooth, deskBluetoothHardware } from "./react";

describe("the desk's Bluetooth watches", () => {
  it("are one per desktop", () => {
    const { domicile } = new FakeDomicileHost();

    expect(deskBluetooth(domicile)).toBe(deskBluetooth(domicile));
    expect(deskBluetoothHardware(domicile)).toBe(
      deskBluetoothHardware(domicile),
    );
  });
});
