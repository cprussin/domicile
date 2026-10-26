import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskSound, deskSoundHardware } from "./react";

describe("the desk's sound watches", () => {
  it("are one per desktop", () => {
    const { domicile } = new FakeDomicileHost();

    expect(deskSound(domicile)).toBe(deskSound(domicile));
    expect(deskSoundHardware(domicile)).toBe(deskSoundHardware(domicile));
  });
});
