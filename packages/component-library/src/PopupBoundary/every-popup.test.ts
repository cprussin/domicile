import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/** The library's components, without their tests and stories. */
const SOURCES = readdirSync(new URL("..", import.meta.url), {
  recursive: true,
})
  .map(String)
  .filter((path) => /(?<!\.test|\.stories)\.tsx$/.test(path));

/**
 * Every base-ui positioner's props: its tag up to its first child. Popups are
 * placed only by these, so a popup that ignores `PopupBoundary` has one
 * without `collisionBoundary`.
 */
const positioners = SOURCES.flatMap((path) =>
  [
    ...readFileSync(new URL(`../${path}`, import.meta.url), "utf8").matchAll(
      /<Base\w+\.Positioner\b[^<]*/g,
    ),
  ].map(([tag]) => ({ path, tag })),
);

describe("every popup", () => {
  it("is found", () => {
    expect(positioners.length).toBeGreaterThan(0);
  });

  it.each(positioners)("in $path stays inside its PopupBoundary", ({ tag }) => {
    expect(tag).toContain("collisionBoundary=");
  });
});
