import { describe, expect, it } from "bun:test";

import { byteSize } from "./byte-size";

describe(byteSize, () => {
  it("names the largest unit the size reaches, to one decimal", () => {
    expect(byteSize(0)).toBe("0 B");
    expect(byteSize(999)).toBe("999 B");
    expect(byteSize(1000)).toBe("1 kB");
    expect(byteSize(1_250_000)).toBe("1.3 MB");
    expect(byteSize(4_800_000_000_000)).toBe("4.8 TB");
  });

  it("stays in terabytes past them", () => {
    expect(byteSize(2_000_000_000_000_000)).toBe("2,000 TB");
  });
});
