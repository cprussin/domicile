import { describe, expect, it } from "bun:test";

import { named, storyUrl } from "./harness";

describe("named", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const known = [a, b];

  it("finds the item with the id", () => {
    expect(named("some-harness", "scene", known, "b")).toBe(b);
  });

  it("throws, listing the known ids, on an unknown one", () => {
    expect(() => named("some-harness", "scene", known, "c")).toThrow(
      "some-harness: no scene c; there are a, b",
    );
  });
});

describe("storyUrl", () => {
  it("frames the story alone, with its args", () => {
    const url = new URL(
      storyUrl(new URL("http://localhost:1234/"), "motion--slowed", "motion:x"),
    );
    expect(url.pathname).toBe("/iframe.html");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      args: "motion:x",
      id: "motion--slowed",
      viewMode: "story",
    });
  });
});
