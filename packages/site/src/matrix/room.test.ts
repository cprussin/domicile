import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../docs/pages";

test("the README links the room by the site's alias", () => {
  expect(readFileSync(join(REPO_ROOT, "README.md"), "utf8")).toContain(
    "https://matrix.to/#/%23domicile:domicile-desktop.com",
  );
});
