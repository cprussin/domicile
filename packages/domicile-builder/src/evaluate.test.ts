import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { evaluate } from "./evaluate";

/** This checkout, which is laid out as Domicile's install is. */
const DOMICILE = path.resolve(import.meta.dir, "..", "..", "..");

describe("evaluate", () => {
  it("is every export of a config but its `Shell`, as JSON", async () => {
    const desk = mkdtempSync(path.join(tmpdir(), "domicile-evaluate-"));
    const config = path.join(desk, "domicile.tsx");
    writeFileSync(
      config,
      `import { DEFAULT_TOP_BAR, runManganese } from "@domicile-desktop/manganese";
         export const input = { keyboard: { xkb_variant: "dvp" } };
         export const extensions = { web_store: ["abc"] };
         export const Shell = runManganese({
           topBar: { ...DEFAULT_TOP_BAR, middle: [<span key="m">mail</span>] },
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
