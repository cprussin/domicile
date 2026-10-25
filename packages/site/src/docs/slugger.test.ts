import { expect, test } from "bun:test";

import { slugger } from "./slugger";

test("ids are GitHub's: lower case, punctuation dropped, spaces dashed", () => {
  const slug = slugger();
  expect(slug("Sleep and logind")).toBe("sleep-and-logind");
  expect(slug("`idle.lock_after_seconds`: two clocks!")).toBe(
    "idlelock_after_seconds-two-clocks",
  );
});

test("a repeated heading gets a number", () => {
  const slug = slugger();
  expect([slug("Options"), slug("Options"), slug("Options")]).toEqual([
    "options",
    "options-1",
    "options-2",
  ]);
});
