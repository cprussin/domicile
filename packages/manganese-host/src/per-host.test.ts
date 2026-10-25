import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { perHost } from "./per-host";

describe("perHost", () => {
  it("makes one value for a desktop and hands it to every caller", () => {
    const made: unknown[] = [];
    const of = perHost((domicile) => {
      made.push(domicile);
      return {};
    });
    const { domicile: host } = new FakeDomicileHost();

    expect(of(host)).toBe(of(host));
    expect(made).toEqual([host]);
  });

  it("makes a separate value for each desktop", () => {
    const of = perHost(() => ({}));

    expect(of(new FakeDomicileHost().domicile)).not.toBe(
      of(new FakeDomicileHost().domicile),
    );
  });
});
