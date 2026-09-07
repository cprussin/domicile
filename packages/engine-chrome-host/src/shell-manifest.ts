// What a shell hands Domicile, and what Domicile does with it.
//
// A shell is a built web page and nothing else — no framework, no bundler, no
// layout this repository dictates. A manifest is how its author says where the
// parts are, so the distribution is theirs to shape:
//
//     { "name": "my-desktop", "module": "dist/shell.js" }
//
// Domicile serves a document it generates itself, and there is no way to
// supply one. That is the point rather than a convenience: the document a
// desktop needs is not interesting — a charset, a viewport, a body with no
// margin that fills the window — and it is the same for every shell, but
// getting it wrong does not look like a mistake in the page. It looks like the
// compositor drawing in the wrong place, which is the most expensive kind of
// bug this project can hand somebody.
//
// NO ESCAPE HATCH, DELIBERATELY. The one thing a hand-written document buys
// today is a blocking script in `<head>` that runs before a render-blocking
// stylesheet — `shell-manganese` uses one to set its theme before the bundle
// paints. Adding a field for that would make every shell's document a little
// negotiable and this contract a little less true, to buy back a flash of the
// wrong colour on one shell. If that turns out to matter it gets solved for
// every shell at once, by not showing a window until the shell has mounted,
// which is a thing only a compositor can do.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

/** What went wrong with a manifest, and where. */
export enum ShellManifestProblem {
  NotJson = "NotJson",
  NotAnObject = "NotAnObject",
  NoModule = "NoModule",
  BadField = "BadField",
  EscapesTheShell = "EscapesTheShell",
}

export const ShellManifestError = {
  BadField: (field: string, found: string) => ({
    field,
    found,
    kind: ShellManifestProblem.BadField as const,
  }),
  EscapesTheShell: (field: string, path: string) => ({
    field,
    kind: ShellManifestProblem.EscapesTheShell as const,
    path,
  }),
  NoModule: () => ({ kind: ShellManifestProblem.NoModule as const }),
  NotAnObject: (found: string) => ({
    found,
    kind: ShellManifestProblem.NotAnObject as const,
  }),
  NotJson: (detail: string) => ({
    detail,
    kind: ShellManifestProblem.NotJson as const,
  }),
};

export type ShellManifestError = ReturnType<
  (typeof ShellManifestError)[keyof typeof ShellManifestError]
>;

export type ShellManifest = {
  /** What to call it in a log. Not an identifier; nothing resolves it. */
  readonly name: string;
  /** The ES module the generated document loads. Relative, and inside. */
  readonly module: string;
  /** Stylesheets the generated document links, in the order given. */
  readonly styles: readonly string[];
};

/**
 * Read a manifest.
 *
 * `text` is the file's contents and `fallbackName` is what to call the shell
 * when it does not name itself — the directory it was found in, which is what
 * a person would call it anyway.
 *
 * Paths are kept relative and are refused if they climb out of the shell.
 * Everything a manifest names is served, so a manifest that can name
 * `../../etc/passwd` is a manifest that can serve it — the same reasoning as
 * `static-path.ts`, one layer earlier.
 */
export const readShellManifest = (
  text: string,
  fallbackName: string,
): Result<ShellManifest, ShellManifestError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return Err(
      ShellManifestError.NotJson(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return Err(ShellManifestError.NotAnObject(nameOf(parsed)));
  }
  const fields = parsed as Record<string, unknown>;

  const name = fields.name;
  if (name !== undefined && typeof name !== "string") {
    return Err(ShellManifestError.BadField("name", nameOf(name)));
  }

  const shellName = name ?? fallbackName;

  const module = fields.module;
  if (module === undefined) {
    return Err(ShellManifestError.NoModule());
  }
  if (typeof module !== "string") {
    return Err(ShellManifestError.BadField("module", nameOf(module)));
  }
  const styles = fields.styles ?? [];
  if (!Array.isArray(styles)) {
    return Err(ShellManifestError.BadField("styles", nameOf(styles)));
  }
  const checked: string[] = [];
  for (const style of styles) {
    if (typeof style !== "string") {
      return Err(ShellManifestError.BadField("styles", nameOf(style)));
    }
    const inside = insideTheShell("styles", style);
    const failed = inside.match({
      Err: (error: ShellManifestError) => error,
      Ok: (path: string) => {
        checked.push(path);
        return undefined;
      },
    });
    if (failed !== undefined) {
      return Err(failed);
    }
  }

  return insideTheShell("module", module).map((inside) => ({
    module: inside,
    name: shellName,
    styles: checked,
  }));
};

/**
 * A path a manifest may name: relative to the manifest, and under it.
 *
 * Normalised to a URL path with no leading slash, because that is what the
 * generated document has to write into a `src` and what the server has to
 * resolve — and doing it here means one answer rather than one per caller.
 */
const insideTheShell = (
  field: string,
  path: string,
): Result<string, ShellManifestError> => {
  // AN ABSOLUTE PATH IS REFUSED, NOT REBASED. Stripping the leading slash and
  // carrying on would serve `etc/passwd` from inside the shell for a manifest
  // that said `/etc/passwd` — a different file than the author named, without
  // saying so. What they meant is not knowable from here, and the two readings
  // are a traversal apart.
  if (path.startsWith("/")) {
    return Err(ShellManifestError.EscapesTheShell(field, path));
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Not "resolve it and check the answer": `a/../../b` and `../b` are the
      // same escape, and popping only when there is something to pop is what
      // makes the second one visible.
      if (segments.length === 0) {
        return Err(ShellManifestError.EscapesTheShell(field, path));
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0
    ? Err(ShellManifestError.EscapesTheShell(field, path))
    : Ok(segments.join("/"));
};

/** What a value is, for a message that has to say what was there instead. */
const nameOf = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
};
