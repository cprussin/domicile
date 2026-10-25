import { afterEach, describe, expect, it } from "bun:test";

import {
  learnedOffset,
  learnOffset,
  OFFSET_KEY,
  parseOffset,
} from "./learned-offset";

describe("learnedOffset", () => {
  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it("is nothing before anything is learned", () => {
    expect(learnedOffset()).toBe(0);
  });

  it("reads back what was learned", () => {
    learnOffset(-0.2);

    expect(learnedOffset()).toBe(-0.2);
  });

  it("stores the offset under its versioned key", () => {
    learnOffset(0.1);

    expect(globalThis.localStorage.getItem(OFFSET_KEY)).toBe('{"offset":0.1}');
  });
});

describe("parseOffset", () => {
  it("counts an unreadable value as nothing learned", () => {
    expect(parseOffset("not json")).toBe(0);
    expect(parseOffset('{"offset":"high"}')).toBe(0);
    expect(parseOffset('{"offset":7}')).toBe(0);
  });
});
