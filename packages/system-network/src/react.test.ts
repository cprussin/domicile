import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { deskNetwork } from "./react";

describe("the desk's network watches", () => {
  it("are one per desktop", () => {
    const { domicile } = new FakeDomicileHost();

    expect(deskNetwork(domicile)).toBe(deskNetwork(domicile));
  });
});
