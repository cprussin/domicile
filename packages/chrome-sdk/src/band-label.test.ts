import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { bandLabelColour, MOST_BANDS } from "./band-label";

/**
 * The other half of `domicile-protocol/tests/band_labels.rs`.
 *
 * The compositor reads a band label off the chrome's own pixels and the chrome
 * paints it, in two languages from two definitions written by hand. Both can be
 * internally consistent and disagree with each other, and what that looks like
 * at runtime is a compositor that never recognises an answer: it asks for band
 * 0 for ever, the chrome renders band 0 for ever, and the desktop shows one
 * layer of its chrome and no more — silently, looking exactly like a shell
 * that declared bands it does not draw.
 */
const FIXTURE = path.join(
  import.meta.dir,
  "../../domicile-protocol/wire/band-labels.jsonl",
);

const labels = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const { band, css } = JSON.parse(line) as { band: number; css: string };
    return { band, css };
  });

describe("the band label fixture", () => {
  it("names every band that fits", () => {
    // Otherwise the file rots by omission: a band the label can carry and the
    // fixture does not mention is one the two sides can disagree about with
    // nothing to catch them.
    expect(labels.map(({ band }) => band)).toStrictEqual(
      Array.from({ length: MOST_BANDS }, (_, band) => band),
    );
  });

  it.each(labels.map(({ band, css }) => [band, css] as const))(
    "paints band %i the colour the compositor reads",
    (band, css) => {
      expect(bandLabelColour(band)).toBe(css);
    },
  );
});

describe("bandLabelColour", () => {
  it("refuses a band that does not fit rather than wrapping it", () => {
    // A wrapped label is a layer of the desktop drawn at another layer's
    // depth, which is the mis-stacking this whole mechanism exists to stop.
    expect(() => bandLabelColour(MOST_BANDS)).toThrow(RangeError);
    expect(() => bandLabelColour(-1)).toThrow(RangeError);
    expect(() => bandLabelColour(1.5)).toThrow(RangeError);
  });
});
