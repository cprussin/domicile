import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { REPO_ROOT } from "../docs/pages";
import { Swap } from "./Swap";

const SCENE = join(
  REPO_ROOT,
  "packages/site/scripts/docs-media/scenes/live-swap",
);

// The section shows the change the recording makes, so they can't drift.
test("shows the rule each of the recording's shells lays its windows out with", () => {
  const html = renderToStaticMarkup(<Swap />).replace(/<[^>]+>/g, "");
  for (const shell of ["side-by-side.js", "stacked.js"]) {
    const rule = /"(main \{[^"]+\})"/.exec(
      readFileSync(join(SCENE, shell), "utf8"),
    )?.[1];
    expect(rule).toBeDefined();
    expect(html).toContain(rule ?? "");
  }
});
