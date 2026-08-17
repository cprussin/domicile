import { describe, expect, it } from "bun:test";

import { withFrameDelimiter } from "./newline-frames";

describe("withFrameDelimiter", () => {
  it("appends the delimiter when it is missing", () => {
    expect(withFrameDelimiter('{"a":1}')).toBe('{"a":1}\n');
  });

  it("leaves an already-delimited frame alone", () => {
    expect(withFrameDelimiter('{"a":1}\n')).toBe('{"a":1}\n');
  });
});
