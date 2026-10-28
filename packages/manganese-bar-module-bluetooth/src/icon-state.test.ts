import { describe, expect, it } from "bun:test";

import { iconStateOf } from "./icon-state";

describe(iconStateOf, () => {
  it.each([
    [false, false, "off"],
    [true, false, "off"],
    [false, true, "on"],
    [true, true, "connected"],
  ])("with a device connected %p and on %p is %s", (connected, on, state) => {
    expect(iconStateOf(connected, on)).toBe(state);
  });
});
