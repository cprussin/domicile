import { describe, expect, it } from "bun:test";

import {
  isFullyZoomedIn,
  isFullyZoomedOut,
  isUnzoomed,
  zoomedIn,
  zoomedOut,
  zoomPercent,
} from "./zoom-steps";

describe("zoomedIn", () => {
  it("steps to the next of Chrome's zoom levels", () => {
    expect(zoomedIn(1)).toBe(1.1);
  });

  // Reported factors are inexact, and stepping from one just below a level
  // must not land on that same level.
  it("steps past a level the browser reported a hair off", () => {
    expect(zoomedIn(1 / 3 - 1e-9)).toBe(0.5);
  });

  it("steps from between two levels to the one above", () => {
    expect(zoomedIn(1.2)).toBe(1.25);
  });

  it("stays at the last level once there", () => {
    expect(zoomedIn(5)).toBe(5);
  });
});

describe("zoomedOut", () => {
  it("steps to the level below", () => {
    expect(zoomedOut(1)).toBe(0.9);
  });

  it("steps past a level the browser reported a hair off", () => {
    expect(zoomedOut(2 / 3 + 1e-9)).toBe(0.5);
  });

  it("stays at the first level once there", () => {
    expect(zoomedOut(0.25)).toBe(0.25);
  });
});

describe("the ends", () => {
  it("says a page at the last level cannot zoom in further", () => {
    expect(isFullyZoomedIn(5 - 1e-9)).toBe(true);
    expect(isFullyZoomedIn(4)).toBe(false);
  });

  it("says a page at the first level cannot zoom out further", () => {
    expect(isFullyZoomedOut(0.25 + 1e-9)).toBe(true);
    expect(isFullyZoomedOut(0.5)).toBe(false);
  });

  it("says a page a hair off 100% is at 100%", () => {
    expect(isUnzoomed(1 + 1e-9)).toBe(true);
    expect(isUnzoomed(1.1)).toBe(false);
  });
});

describe("zoomPercent", () => {
  it("names a factor as the percentage a browser shows", () => {
    expect(zoomPercent(1 / 3)).toBe("33%");
    expect(zoomPercent(1.25)).toBe("125%");
  });
});
