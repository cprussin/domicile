import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { compileModule, compileShell } from "./compile";

describe("compileModule", () => {
  it("runs TypeScript, with its imports from the modules given", () => {
    const module = compileModule(
      `import { greeting } from "greet";
       export const shout = (to: string): string => \`\${greeting}, \${to}!\`;`,
      { greet: { greeting: "hi" } },
    );

    expect(
      module.map((exports) => (exports.shout as (to: string) => string)("you")),
    ).toEqual(Ok("hi, you!"));
  });

  it("compiles JSX for the React given as `react/jsx-runtime`", () => {
    const module = compileModule("export const element = <p>hi</p>;", {
      "react/jsx-runtime": { jsx: (type: string) => `<${type}>` },
    });

    expect(module.map((exports) => exports.element as string)).toEqual(
      Ok("<p>"),
    );
  });

  it("is the error for code that doesn't parse", () => {
    expect(compileModule("export const = 1;", {}).isErr()).toBe(true);
  });

  it("is an error naming an import it wasn't given", () => {
    expect(compileModule('import "left-pad";', {})).toEqual(
      Err("The preview can't load left-pad."),
    );
  });
});

describe("compileShell", () => {
  it("is the module's `Shell`", () => {
    const root = document.createElement("div");

    compileShell(
      "export const Shell = (root) => { root.textContent = 'drawn'; };",
      {},
    ).match({
      Err: (error) => {
        throw new Error(error);
      },
      Ok: (shell) => shell(root, undefined as never),
    });

    expect(root.textContent).toBe("drawn");
  });

  it("is an error for a module without a `Shell` function", () => {
    expect(compileShell("export const Desktop = 1;", {})).toEqual(
      Err(
        "Export your desktop as `Shell`: export const Shell = mount(Desktop);",
      ),
    );
  });
});
