import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../../docs/pages";
import { GET } from "./route";

test("serves the config schema of the Domicile the site documents", async () => {
  const response = GET();

  expect(response.headers.get("content-type")).toBe("application/schema+json");
  expect(await response.text()).toBe(
    readFileSync(
      join(REPO_ROOT, "packages/chrome-sdk/config.schema.json"),
      "utf8",
    ),
  );
});

test("every docs page names this schema, not one that can drift", () => {
  for (const page of ["docs/SHELL-CONFIG.md", "docs/use/CONFIGURE.md"]) {
    const text = readFileSync(join(REPO_ROOT, page), "utf8");
    expect(text).toContain("https://domicile-desktop.com/config.schema.json");
    expect(text).not.toContain(
      "unpkg.com/@domicile-desktop/sdk/config.schema.json",
    );
  }
});
