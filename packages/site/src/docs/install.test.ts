import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./pages";

/** A guide's package manager tabs, Debian through Arch. */
const packageTabs = (file: string): string => {
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  return text.slice(
    text.indexOf("<!-- tab: Debian and Ubuntu -->"),
    text.indexOf("<!-- tab: NixOS -->"),
  );
};

// Domicile's install guide and manganese's both carry the steps, so an end
// user finds them in the user guide. They must not drift apart.
test("Domicile's and manganese's install guides install the same way", () => {
  const domicile = packageTabs("docs/INSTALL.md");
  expect(domicile).toContain("sudo apt install domicile");
  expect(domicile).toBe(packageTabs("docs/use/INSTALL.md"));
});
