import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "./bundle";

/** This checkout, which is laid out as Domicile's install is. */
const DOMICILE = path.resolve(import.meta.dir, "..", "..", "..");

describe("bundle", () => {
  // The one test that builds: a user's entry outside any project, importing
  // manganese and React from Domicile and nothing installed of its own.
  it("builds an entry against Domicile's manganese into a module with its `Shell` and its styles", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    writeFileSync(
      entry,
      `import { DEFAULT_TOP_BAR, runManganese } from "@domicile/shell-manganese";
         const Mail = () => <span>mail 3/12</span>;
         export const Shell = runManganese({
           topBar: { ...DEFAULT_TOP_BAR, middle: [<Mail key="mail" />] },
         });`,
    );

    await bundle(entry, path.join(desk, "out"), DOMICILE, [entry]);

    const built = readFileSync(path.join(desk, "out", "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("mail 3/12");
    expect(built).toContain("@layer utilities");
  }, 120_000);

  // A rule only exists for a `css()` call the build scanned, so a user's own
  // call must be scanned beside manganese's.
  it("builds the rules of the user's own `css()` calls", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    const item = path.join(desk, "mail.tsx");
    writeFileSync(
      item,
      `import { css } from "@domicile/shell-manganese/css";
         export const Mail = () => (
           <span className={css({ color: "rgb(1, 2, 3)" })}>mail</span>
         );`,
    );
    writeFileSync(
      entry,
      `import { DEFAULT_TOP_BAR, runManganese } from "@domicile/shell-manganese";
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
