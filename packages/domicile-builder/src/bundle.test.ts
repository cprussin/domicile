import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "./bundle";

/** This checkout, which has the same layout as a Domicile install. */
const DOMICILE = path.resolve(import.meta.dir, "..", "..", "..");

describe("bundle", () => {
  // An entry outside any project, with nothing installed, gets manganese, its
  // packages and React from Domicile. Its output directory's parent does not exist yet, as
  // in a fresh cache.
  it("builds an entry against Domicile's manganese into a module with its `Shell` and its styles", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    writeFileSync(
      entry,
      `import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
         import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
         const Mail = () => <span>mail 3/12</span>;
         export const Shell = runManganese({
           bar: { ...DEFAULT_BAR, center: [<Clock key="clock" />, <Mail key="mail" />] },
         });`,
    );

    const out = path.join(desk, "shells", "out");
    await bundle(entry, out, DOMICILE);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("mail 3/12");
    // manganese's prebuilt stylesheet: its tokens and its rules.
    expect(built).toContain("@layer tokens");
    expect(built).toContain("@layer utilities");
  }, 120_000);

  // A package no default uses still resolves from Domicile's install.
  it("builds an entry with an inbox no default has", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.tsx");
    writeFileSync(
      entry,
      `import { runManganese } from "@domicile-desktop/manganese";
         import { gmailInbox } from "@domicile-desktop/manganese-inbox-gmail";
         export const Shell = runManganese({
           inboxes: [
             gmailInbox({
               client: { id: "id", secret: "secret" },
               email: "me@gmail.com",
               nickname: "Work",
             }),
           ],
         });`,
    );

    const out = path.join(desk, "out");
    await bundle(entry, out, DOMICILE);

    expect(readFileSync(path.join(out, "shell.js"), "utf8")).toContain(
      "https://mail.google.com",
    );
  }, 120_000);

  // The shell SHELL-QUICKSTART.md teaches, so the doc's code keeps building.
  it("builds the React example shell, which imports only React and the SDK", async () => {
    const entry = path.join(DOMICILE, "examples", "react-shell", "shell.tsx");
    const out = path.join(
      mkdtempSync(path.join(tmpdir(), "domicile-builder-")),
      "out",
    );

    await bundle(entry, out, DOMICILE);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("royalblue");
  }, 120_000);

  // The same shell in plain JavaScript, which the quickstart's other tab
  // teaches.
  it("builds the plain JavaScript example shell", async () => {
    const entry = path.join(DOMICILE, "examples", "vanilla-shell", "shell.js");
    const out = path.join(
      mkdtempSync(path.join(tmpdir(), "domicile-builder-")),
      "out",
    );

    await bundle(entry, out, DOMICILE);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("royalblue");
  }, 120_000);
});
