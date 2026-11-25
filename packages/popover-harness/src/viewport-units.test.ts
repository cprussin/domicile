import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const PACKAGES = new URL("../../", import.meta.url);

/** Package `name`'s components, without their tests and stories. */
const sourcesOf = (name: string): { path: string; source: string }[] => {
  const src = new URL(`${name}/src/`, PACKAGES);
  return existsSync(src)
    ? readdirSync(src, { recursive: true })
        .map(String)
        .filter((path) => /(?<!\.test|\.stories)\.tsx$/.test(path))
        .map((path) => ({
          path: `${name}/src/${path}`,
          source: readFileSync(new URL(path, src), "utf8"),
        }))
    : [];
};

/**
 * Every source file outside tests and stories that draws a `Popover`. The
 * desk is one page across every monitor, so `vh` and `vw` measure the desk,
 * not the screen a panel opens on.
 */
const drawers = readdirSync(PACKAGES)
  .flatMap(sourcesOf)
  .filter(({ source }) =>
    source.includes('"@domicile-desktop/component-library/Popover"'),
  );

describe("every popover's content", () => {
  it("is found", () => {
    expect(drawers.length).toBeGreaterThan(10);
  });

  it.each(drawers)(
    "in $path sizes to its screen, not the desk",
    ({ source }) => {
      expect(source).not.toMatch(/\d(vh|vw)\b/);
    },
  );
});
