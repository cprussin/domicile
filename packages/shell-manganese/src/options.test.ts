import { describe, expect, it } from "bun:test";

import { options } from "./options";

describe("options", () => {
  it("offers the night light's hours by the half hour", () => {
    const { from } = options.nightLight.options;

    expect(from.choices.slice(0, 3)).toEqual(["00:00", "00:30", "01:00"]);
    expect(from.choices.at(-1)).toBe("23:30");
    expect(from.choices).toContain(from.default);
  });
});
