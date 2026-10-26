import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readOptions } from "@domicile-desktop/sdk/options";

import { options } from "./options";

const GUIDE = join(import.meta.dir, "../../../docs/use");

/** Every JSON block in the user guide that sets `shell_options`. */
const examples = readdirSync(GUIDE)
  .filter((name) => name.endsWith(".md"))
  .flatMap((name) =>
    [
      ...readFileSync(join(GUIDE, name), "utf8").matchAll(
        /```json\n([\s\S]*?)```/g,
      ),
    ]
      .map((match) => match[1] ?? "")
      .filter((block) => block.includes('"shell_options"'))
      .map((block) => ({ block, name })),
  );

describe("the user guide's shell_options", () => {
  it("has examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)("are all manganese options in $name", ({ block }) => {
    const { shell_options } = JSON.parse(block) as {
      shell_options: Record<string, unknown>;
    };

    expect(readOptions(options, shell_options).dropped).toEqual([]);
  });
});
