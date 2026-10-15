import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { evaluate, extractOptions } from "./evaluate";

/** This checkout, which is laid out as Domicile's install is. */
const DOMICILE = path.resolve(import.meta.dir, "..", "..", "..");

describe("evaluate", () => {
  it("is every export of a config but its `Shell` and `options`, as JSON", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-evaluate-"));
    const config = path.join(desk, "domicile.tsx");
    writeFileSync(
      config,
      `import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
         import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
         import { DEFAULT_KEYBINDINGS } from "@domicile-desktop/manganese-window-management/keyboard/commands";
         export const input = { keyboard: { xkb_variant: "dvp" } };
         export const extensions = { web_store: ["abc"] };
         export const options = {};
         export const Shell = runManganese({
           bar: { ...DEFAULT_BAR, center: [<Clock key="clock" />] },
           keybindings: { keybindings: DEFAULT_KEYBINDINGS },
         });`,
    );
    const out = path.join(desk, "config.json");

    await evaluate(config, out, DOMICILE);

    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
      extensions: { web_store: ["abc"] },
      input: { keyboard: { xkb_variant: "dvp" } },
    });
  }, 60_000);
});

describe("extractOptions", () => {
  it("writes the options a shell declares as JSON", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-options-"));
    const entry = path.join(desk, "shell.ts");
    writeFileSync(
      entry,
      `import { defineOptions, option } from "@domicile-desktop/sdk/options";
         export const options = defineOptions({
           clock: { seconds: option.toggle("Show seconds", true) },
         });
         export const Shell = () => undefined;`,
    );
    const out = path.join(desk, "options.json");

    await extractOptions(entry, out, DOMICILE);

    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
      clock: {
        kind: "group",
        options: {
          seconds: { default: true, kind: "toggle", label: "Show seconds" },
        },
      },
    });
  }, 60_000);

  it("writes nothing for a shell that declares none", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-options-"));
    const entry = path.join(desk, "shell.ts");
    writeFileSync(entry, "export const Shell = () => undefined;");
    const out = path.join(desk, "options.json");

    await extractOptions(entry, out, DOMICILE);

    expect(existsSync(out)).toBe(false);
  }, 60_000);
});
