// Syntax highlighting for the text preview: splits text into lines of scoped
// runs.
//
// Flat runs per line rather than a tree, because the preview draws (and
// numbers) one line at a time and tree spans cross lines. Scopes are names
// like `keyword` or `comment`; `TextPreview` maps them to desktop colors.

import { common, createLowlight } from "lowlight";

import { org } from "./org";

/** A run of text and its scope, if any. */
export type Run = { scope: string | undefined; text: string };

/** Known grammars: `highlight.js`'s common set, plus Org. */
const lowlight = createLowlight({ ...common, org });

/** Names of `highlight.js`'s plain-text grammar, which highlights nothing. */
const PLAIN = new Set(["plaintext", "text", "txt"]);

/**
 * The grammar name for `path`, by extension or else by file name, or
 * `undefined` if none matches. Pass the result to `highlight`.
 */
export const languageOf = (path: string): string | undefined => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const said = dot === -1 ? name : name.slice(dot + 1);
  return lowlight.registered(said) && !PLAIN.has(said) ? said : undefined;
};

/**
 * Split `text` into lines of runs, highlighted in `language` if given. A
 * trailing newline does not add an empty last line.
 */
export const highlight = (
  language: string | undefined,
  text: string,
): readonly (readonly Run[])[] =>
  linesOf(
    language === undefined
      ? [{ scope: undefined, text }]
      : runsOf(lowlight.highlight(language, text).children, undefined),
  ).filter((line, at, lines) => at < lines.length - 1 || line.length > 0);

type Node = ReturnType<typeof lowlight.highlight>["children"][number];

/** Flatten a syntax tree into runs, each with its innermost scope. */
const runsOf = (nodes: readonly Node[], scope: string | undefined): Run[] =>
  nodes.flatMap((node) => {
    switch (node.type) {
      case "text": {
        return [{ scope, text: node.value }];
      }
      case "element": {
        return runsOf(
          node.children,
          scopeOf(node.properties.className) ?? scope,
        );
      }
      case "comment":
      case "doctype": {
        return [];
      }
    }
  });

/** The scope of a class list, e.g. `title` for `["hljs-title", "function_"]`. */
const scopeOf = (className: unknown): string | undefined => {
  const first = Array.isArray(className) ? className[0] : undefined;
  return typeof first === "string" && first.startsWith("hljs-")
    ? first.slice("hljs-".length)
    : undefined;
};

/** Split runs into lines at each newline, dropping empty runs. */
const linesOf = (runs: readonly Run[]): Run[][] => {
  const lines: Run[][] = [];
  let line: Run[] = [];
  for (const run of runs) {
    for (const [at, text] of run.text.split("\n").entries()) {
      if (at > 0) {
        lines.push(line);
        line = [];
      }
      if (text !== "") {
        line.push({ scope: run.scope, text });
      }
    }
  }
  return [...lines, line];
};
