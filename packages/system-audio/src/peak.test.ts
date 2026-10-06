import { describe, expect, it } from "bun:test";

import { peak } from "./peak";

const floats = (...samples: number[]): Uint8Array =>
  new Uint8Array(new Float32Array(samples).buffer);

describe("peak", () => {
  it("is the loudest sample either way", () => {
    expect(peak(new Uint8Array(), floats(0.1, -0.75, 0.5))).toStrictEqual({
      loudest: 0.75,
      rest: new Uint8Array(),
    });
    expect(peak(new Uint8Array(), new Uint8Array()).loudest).toBe(0);
  });

  // Float samples can exceed full scale.
  it("never reads past full scale", () => {
    expect(peak(new Uint8Array(), floats(1.5)).loudest).toBe(1);
  });

  it("carries a sample split between reads into the next", () => {
    const bytes = floats(0.25, -0.5);
    const first = peak(new Uint8Array(), bytes.slice(0, 6));

    expect(first.loudest).toBe(0.25);
    expect(peak(first.rest, bytes.slice(6)).loudest).toBe(0.5);
  });
});
