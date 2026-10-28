// Runs a shell's source in the browser, for the "Make your own desktop"
// preview: TypeScript and JSX compiled with sucrase, imports from a fixed set
// of modules.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Shell } from "@domicile-desktop/sdk/shell";
import { transform } from "sucrase";

/** The modules a compiled module may import, by specifier. */
export type Modules = Readonly<Record<string, unknown>>;

/** The `Shell` that `code` exports, or what stops it, as `compileModule`. */
export const compileShell = (
  code: string,
  modules: Modules,
): Result<Shell, string> =>
  compileModule(code, modules).andThen((exports) =>
    typeof exports.Shell === "function"
      ? Ok(exports.Shell as Shell)
      : Err(
          "Export your desktop as `Shell`: export const Shell = mount(Desktop);",
        ),
  );

/**
 * Compile and run `code`, answering its exports, or the error that stopped it
 * as a message to show the person editing it.
 */
export const compileModule = (
  code: string,
  modules: Modules,
): Result<Record<string, unknown>, string> => {
  try {
    const { code: compiled } = transform(code, {
      jsxRuntime: "automatic",
      production: true,
      transforms: ["typescript", "jsx", "imports"],
    });
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", compiled)(requireFrom(modules), exports);
    return Ok(exports);
  } catch (error) {
    return Err(error instanceof Error ? error.message : String(error));
  }
};

/** A `require` that answers only `modules`. */
const requireFrom =
  (modules: Modules) =>
  (specifier: string): unknown => {
    if (Object.hasOwn(modules, specifier)) {
      return modules[specifier];
    } else {
      throw new Error(`The preview can't load ${specifier}.`);
    }
  };
