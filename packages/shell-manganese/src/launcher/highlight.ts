// A text file's front as the launcher's preview draws it: cut into lines, and
// each line into runs of what a grammar says the text is.
//
// Runs rather than the grammar's own tree, because the pane draws a line at a
// time — the gutter numbers them — and a tree's spans cross lines. What a run
// *is* is a word (`keyword`, `string`, `comment`), and what that word looks
// like is the pane's to say in the desktop's own colors, so a light desk and a
// dark one are the same highlighting.

import { common, createLowlight } from "lowlight";

import { org } from "./org";

/** A piece of a line, and what a grammar says it is, if it says anything. */
export type Run = { scope: string | undefined; text: string };

/** The grammars a preview knows: `highlight.js`'s common set, and Org. */
const lowlight = createLowlight({ ...common, org });

/**
 * The names `highlight.js`'s plain-text grammar goes by. Plain text is not a
 * language: it has nothing to light.
 */
const PLAIN = new Set(["plaintext", "text", "txt"]);

/**
 * The grammar `path` is written in, by its extension or, with none, by its
 * name — or `undefined` for one no grammar is for. The name is the one the
 * grammar was found by, which is what `highlight` takes.
 */
export const languageOf = (path: string): string | undefined => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const said = dot === -1 ? name : name.slice(dot + 1);
  return lowlight.registered(said) && !PLAIN.has(said) ? said : undefined;
};

/**
 * `text` in `language` as lines of runs, or as plain runs with none. A file
 * that ends in a newline ends its last line with it rather than opening one
 * more.
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

/** A grammar's tree, flattened, each run taking the scope nearest it. */
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

/** `hljs-title` of `["hljs-title", "function_"]`, as `title`. */
const scopeOf = (className: unknown): string | undefined => {
  const first = Array.isArray(className) ? className[0] : undefined;
  return typeof first === "string" && first.startsWith("hljs-")
    ? first.slice("hljs-".length)
    : undefined;
};

/**
 * Runs cut at every newline, a run the cut left empty dropped. A loop, because
 * a line is built up a run at a time and handed on at each newline.
 */
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
