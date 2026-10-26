import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { perDesktop } from "./per-desktop";

describe("perDesktop", () => {
  it("makes one value for a desktop and hands it to every caller", () => {
    const made: unknown[] = [];
    const of = perDesktop((domicile) => {
      made.push(domicile);
      return {};
    });
    const { domicile: host } = new FakeDomicileHost();

    expect(of(host)).toBe(of(host));
    expect(made).toEqual([host]);
  });

  it("makes a separate value for each desktop", () => {
    const of = perDesktop(() => ({}));

    expect(of(new FakeDomicileHost().domicile)).not.toBe(
      of(new FakeDomicileHost().domicile),
    );
  });
});
