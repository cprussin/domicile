import { describe, expect, it } from "bun:test";

import {
  createFrameReader,
  takeFrames,
  withFrameDelimiter,
} from "./newline-frames";

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

describe("createFrameReader", () => {
  it("yields each complete frame as its delimiter arrives", () => {
    const read = createFrameReader();
    expect(read('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(read("2}\n")).toEqual(['{"b":2}']);
  });

  it("holds a frame split across many chunks until it is whole", () => {
    const read = createFrameReader();
    expect(read('{"a":')).toEqual([]);
    expect(read('"long')).toEqual([]);
    expect(read('"}\n')).toEqual(['{"a":"long"}']);
  });

  it("drops blank frames from keepalive newlines", () => {
    const read = createFrameReader();
    expect(read('\n  \n{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it("reassembles a large frame in linear time", () => {
    // A GPU client's frame is megabytes of base64 arriving in many small
    // chunks. Re-joining everything on each chunk is quadratic, which at this
    // size costs seconds of copying and stalls the chrome — so this asserts on
    // elapsed time, the only thing that distinguishes the two implementations.
    const read = createFrameReader();
    const chunk = "x".repeat(64 * 1024);
    const started = performance.now();
    for (let i = 0; i < 400; i++) {
      expect(read(chunk)).toEqual([]);
    }
    const [frame] = read("\n");
    expect(frame).toHaveLength(400 * chunk.length);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
