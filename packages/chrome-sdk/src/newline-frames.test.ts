import { describe, expect, it } from "bun:test";

import { takeFrames, withFrameDelimiter } from "./newline-frames";

describe("takeFrames", () => {
  it("splits complete frames and keeps the partial tail", () => {
    expect(takeFrames('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      frames: ['{"a":1}', '{"b":2}'],
      rest: '{"c":',
    });
  });

  it("yields no frames until a newline arrives", () => {
    expect(takeFrames('{"a":')).toEqual({ frames: [], rest: '{"a":' });
  });

  it("drops blank frames from keepalive newlines", () => {
    expect(takeFrames('\n  \n{"a":1}\n')).toEqual({
      frames: ['{"a":1}'],
      rest: "",
    });
  });
});

describe("withFrameDelimiter", () => {
  it("appends the delimiter when it is missing", () => {
    expect(withFrameDelimiter('{"a":1}')).toBe('{"a":1}\n');
  });

  it("leaves an already-delimited frame alone", () => {
    expect(withFrameDelimiter('{"a":1}\n')).toBe('{"a":1}\n');
  });
});
