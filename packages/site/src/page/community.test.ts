import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../docs/pages";
import { DISCORD } from "./community";

test("the README links the community's chat", () => {
  expect(readFileSync(join(REPO_ROOT, "README.md"), "utf8")).toContain(DISCORD);
});
