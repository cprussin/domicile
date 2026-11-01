import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import manifest from "../package.json";

const PACKAGE = path.resolve(import.meta.dir, "..");

/** The exported modules that render, each a shell's way in to the styles. */
const COMPONENTS = Object.values(manifest.exports).filter((target) =>
  target.endsWith(".tsx"),
);

// A shell with no Panda step gets the rules only from the prebuilt sheet, so
// every component loads it, whichever one the shell imports first.
describe("the prebuilt stylesheet", () => {
  it.each(COMPONENTS)("is loaded by %s", (target) => {
    const file = path.join(PACKAGE, target);
    const sheet = path.relative(
      path.dirname(file),
      path.join(PACKAGE, "src", "stylesheet"),
    );
    expect(readFileSync(file, "utf8")).toContain(`import "${sheet}";`);
  });
});
