import { describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  // The project's own config adds its tools; the builder's shell settings win
  // over its output settings.
  it("builds with the project's vite config", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "domicile.ts");
    const config = path.join(desk, "vite.config.mjs");
    writeFileSync(
      entry,
      `export const Shell = () => console.log(__GREETING__);`,
    );
    writeFileSync(
      config,
      `export default {
         build: { outDir: "elsewhere", rollupOptions: { input: "nothing.ts" } },
         define: { __GREETING__: JSON.stringify("hello from the config") },
       };`,
    );

    const out = path.join(desk, "out");
    await bundle(entry, out, DOMICILE, config);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("hello from the config");
  }, 120_000);

  // SHELL-PACKAGING.md's Panda recipe: the user's `css()` calls get rules.
  it("builds the rules of the user's `css()` calls with a Panda vite config", async () => {
    // Outside Domicile's packages, as a user's config is, with this
    // package's `@pandacss/dev` and manganese installed.
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    cpSync(path.join(import.meta.dir, "..", "fixtures", "panda-shell"), desk, {
      recursive: true,
    });
    symlinkSync(
      path.join(import.meta.dir, "..", "node_modules"),
      path.join(desk, "node_modules"),
    );
    const out = path.join(desk, "out");

    await bundle(
      path.join(desk, "domicile.tsx"),
      out,
      DOMICILE,
      path.join(desk, "vite.config.ts"),
    );

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/\{color:#010203\}/);
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

  // A shell of its own that mounts only the portal dialogs gets the component
  // library's prebuilt stylesheet, with no Panda step.
  it("builds the component library's styles into a shell that mounts only `PortalDialogs`", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-builder-"));
    const entry = path.join(desk, "shell.tsx");
    writeFileSync(
      entry,
      `import { PortalDialogs } from "@domicile-desktop/component-library/PortalDialogs";
         import { mount } from "@domicile-desktop/react/mount";
         import { useDomicile } from "@domicile-desktop/react/domicile-provider";
         const Desktop = () => <PortalDialogs domicile={useDomicile()} />;
         export const Shell = mount(Desktop);`,
    );

    const out = path.join(desk, "out");
    await bundle(entry, out, DOMICILE);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toContain("@layer tokens");
    expect(built).toContain("@layer utilities");
  }, 120_000);

  // The bar item the manganese homepage shows, on manganese.
  it("builds the manganese bar item example", async () => {
    const entry = path.join(
      DOMICILE,
      "examples",
      "manganese-bar-item",
      "domicile.tsx",
    );
    const out = path.join(
      mkdtempSync(path.join(tmpdir(), "domicile-builder-")),
      "out",
    );

    await bundle(entry, out, DOMICILE);

    const built = readFileSync(path.join(out, "shell.js"), "utf8");
    expect(built).toMatch(/export\s*\{[^}]*\bas Shell\b/);
    expect(built).toContain("Asia/Tokyo");
    expect(built).toContain("margin-inline-start");
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
