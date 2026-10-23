// Syntax highlighting for the site's code blocks: splits code into lines of
// colored runs, at build time.

import { common, createLowlight } from "lowlight";

/** The colors a run can take, named after `syntax.*` tokens. */
export type Tone =
  | "attr"
  | "comment"
  | "function"
  | "keyword"
  | "number"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "tag";

/** A run of code and its color. */
export type Run = { text: string; tone: Tone };

/** A grammar from `highlight.js`'s common set, or `plain` for none. */
export type Language = "bash" | "css" | "json" | "plain" | "tsx";

const lowlight = createLowlight(common);

/** Splits `code` into lines of runs. A trailing newline adds no line. */
export const highlight = (
  language: Language,
  code: string,
): readonly (readonly Run[])[] =>
  linesOf(
    language === "plain"
      ? [{ text: code, tone: "plain" }]
      : runsOf(lowlight.highlight(grammarOf(language), code).children, "plain"),
  ).filter((line, at, lines) => at < lines.length - 1 || line.length > 0);

type Node = ReturnType<typeof lowlight.highlight>["children"][number];

// `highlight.js` has no TSX grammar; its TypeScript one handles JSX.
const grammarOf = (language: Exclude<Language, "plain">): string =>
  language === "tsx" ? "typescript" : language;

/** Flattens a syntax tree into runs, each with its innermost scope's tone. */
const runsOf = (nodes: readonly Node[], tone: Tone): Run[] =>
  nodes.flatMap((node) => {
    switch (node.type) {
      case "text": {
        return [{ text: node.value, tone }];
      }
      case "element": {
        return runsOf(node.children, toneOf(node.properties.className) ?? tone);
      }
      default: {
        return [];
      }
    }
  });

/** The tone for an `hljs-*` class list, or `undefined` to inherit. */
const toneOf = (className: unknown): Tone | undefined => {
  const scope = Array.isArray(className)
    ? className
        .filter((name): name is string => typeof name === "string")
        .find((name) => name.startsWith("hljs-"))
        ?.slice("hljs-".length)
    : undefined;
  return scope === undefined ? undefined : TONES[scope];
};

const TONES: Readonly<Record<string, Tone>> = {
  attr: "attr",
  // CSS properties.
  attribute: "property",
  built_in: "function",
  comment: "comment",
  keyword: "keyword",
  literal: "keyword",
  meta: "comment",
  name: "tag",
  number: "number",
  params: "plain",
  property: "property",
  punctuation: "punctuation",
  "selector-class": "tag",
  "selector-tag": "tag",
  string: "string",
  tag: "tag",
  title: "function",
  "title.function_": "function",
  type: "function",
  variable: "property",
};

/** Splits runs at newlines into lines, dropping empty runs. */
const linesOf = (runs: readonly Run[]): Run[][] =>
  runs.reduce<Run[][]>(
    (lines, run) => {
      const [first = "", ...rest] = run.text.split("\n");
      const last = lines.at(-1) ?? [];
      const head = first === "" ? last : [...last, { ...run, text: first }];
      return [
        ...lines.slice(0, -1),
        head,
        ...rest.map((text) => (text === "" ? [] : [{ ...run, text }])),
      ];
    },
    [[]],
  );
