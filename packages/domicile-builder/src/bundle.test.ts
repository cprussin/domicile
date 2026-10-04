import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "./bundle";

/** This checkout, which has the same layout as a Domicile install. */
const DOMICILE = path.resolve(import.meta.dir, "..", "..", "..");

describe("bundle", () => {
  // An entry outside any project, with nothing installed, gets manganese and
  // React from Domicile. Its output directory's parent does not exist yet, as
  // in a fresh cache.
  it("builds an entry against Domicile's manganese into a module with its `Shell` and its styles", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    writeFileSync(
      entry,
      `import { DEFAULT_TOP_BAR, runManganese } from "@domicile-desktop/manganese";
         const Mail = () => <span>mail 3/12</span>;
         export const Shell = runManganese({
           topBar: { ...DEFAULT_TOP_BAR, middle: [<Mail key="mail" />] },
         });`,
    );

    const out = path.join(desk, "shells", "out");
    await bundle(entry, out, DOMICILE, [entry]);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("mail 3/12");
    expect(built).toContain("@layer utilities");
  }, 120_000);

  // Panda only emits rules for `css()` calls it scans, so the user's files
  // must be scanned too.
  it("builds the rules of the user's own `css()` calls", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    const item = path.join(desk, "mail.tsx");
    writeFileSync(
      item,
      `import { css } from "@domicile-desktop/manganese/css";
         export const Mail = () => (
           <span className={css({ color: "rgb(1, 2, 3)" })}>mail</span>
         );`,
    );
    writeFileSync(
      entry,
      `import { DEFAULT_TOP_BAR, runManganese } from "@domicile-desktop/manganese";
         import { Mail } from "./mail";
         export const Shell = runManganese({
           topBar: { ...DEFAULT_TOP_BAR, middle: [<Mail key="mail" />] },
         });`,
    );

    await bundle(entry, path.join(desk, "out"), DOMICILE, [entry, item]);

    const built = readFileSync(path.join(desk, "out", "shell.js"), "utf8");
    expect(built).toContain("rgb(1, 2, 3)");
  }, 120_000);
});
