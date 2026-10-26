import { describe, expect, it } from "bun:test";

import {
  learnedOffset,
  learnOffset,
  OFFSET_KEY,
  parseOffset,
} from "./learned-offset";

/** A page's storage, in memory. */
const storage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

describe("learnedOffset", () => {
  it("is nothing before anything is learned", () => {
    expect(learnedOffset(storage())).toBe(0);
  });

  it("reads back what was learned", () => {
    const stored = storage();
    learnOffset(-0.2, stored);

    expect(learnedOffset(stored)).toBe(-0.2);
  });

  it("stores the offset under its versioned key", () => {
    const stored = storage();
    learnOffset(0.1, stored);

    expect(stored.getItem(OFFSET_KEY)).toBe('{"offset":0.1}');
  });
});

describe("parseOffset", () => {
  it("counts an unreadable value as nothing learned", () => {
    expect(parseOffset("not json")).toBe(0);
    expect(parseOffset('{"offset":"high"}')).toBe(0);
    expect(parseOffset('{"offset":7}')).toBe(0);
  });
});
