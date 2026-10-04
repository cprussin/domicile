import { describe, expect, it } from "bun:test";

import { superseded } from "./superseded";

describe("superseded", () => {
  it("is an ask a newer one replaced", () => {
    expect(superseded(new DOMException("newer ask", "AbortError"))).toBe(true);
  });

  it("is not any other failure", () => {
    expect(superseded(new DOMException("gone", "NotFoundError"))).toBe(false);
    expect(superseded(new Error("AbortError"))).toBe(false);
  });
});
