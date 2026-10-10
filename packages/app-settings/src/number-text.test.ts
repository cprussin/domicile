import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { parseNumber } from "./number-text";

describe(parseNumber, () => {
  it("reads a number", () => {
    expect(parseNumber(" 1.5 ", { integer: false, positive: true })).toEqual(
      Ok(1.5),
    );
    expect(parseNumber("-1920", { integer: true, positive: false })).toEqual(
      Ok(-1920),
    );
  });

  it("says why it refused one", () => {
    expect(parseNumber("", { integer: true, positive: false })).toEqual(
      Err("Type a number"),
    );
    expect(parseNumber("1.5", { integer: true, positive: true })).toEqual(
      Err("1.5 is not a whole number"),
    );
    expect(parseNumber("0", { integer: false, positive: true })).toEqual(
      Err("0 is not more than 0"),
    );
  });
});
