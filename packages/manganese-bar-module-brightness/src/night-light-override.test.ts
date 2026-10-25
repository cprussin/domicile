import { afterEach, describe, expect, it } from "bun:test";

import {
  OVERRIDE_KEY,
  parseOverride,
  storedOverride,
  storeOverride,
} from "./night-light-override";

describe("storedOverride", () => {
  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it("is none before the user overrides the schedule", () => {
    expect(storedOverride()).toBeUndefined();
  });

  it("reads back what was stored", () => {
    storeOverride({ on: true, until: 1000 });

    expect(storedOverride()).toEqual({ on: true, until: 1000 });
  });

  it("clears the override", () => {
    storeOverride({ on: false });

    storeOverride(undefined);

    expect(globalThis.localStorage.getItem(OVERRIDE_KEY)).toBeNull();
  });
});

describe("parseOverride", () => {
  it("counts an unreadable value as none", () => {
    expect(parseOverride("not json")).toBeUndefined();
    expect(parseOverride('{"on":"yes"}')).toBeUndefined();
  });
});
