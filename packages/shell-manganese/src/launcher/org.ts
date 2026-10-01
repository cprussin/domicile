// An Org file's grammar, which `highlight.js` has none of: its outline,
// markup and metadata, in the words the preview lights. Most are the words
// every grammar uses; a headline's level, its keyword, its priority and its
// tags, and a table's cells, are Org's own (`heading-1`, `todo`, `table`…).

import type { common } from "lowlight";

type Grammar = (typeof common)[keyof typeof common];

type Api = Parameters<Grammar>[0];

/**
 * Org's grammar, for `lowlight.register`. A source block is lit in its own
 * language, so the grammar takes every language registered before it.
 */
export const org: Grammar = (hljs) => ({
  contains: [
    {
      begin: /^\*+ (?=(DONE|CANCELED)\b)/,
      className: "heading-done",
      contains: [
        { begin: /(?<=^\*+ )(DONE|CANCELED)\b/, className: "done" },
        ...HEADLINE,
      ],
      end: /$/,
    },
    // A headline's level as Org's own faces have it: four apart, then round
    // again.
    ...[1, 2, 3, 4].map((level) => ({
      begin: new RegExp(`^\\*{${level.toString()}}(\\*{4})* `),
      className: `heading-${level.toString()}`,
      contains: [
        { begin: /(?<=^\*+ )(TODO|NEXT|WAIT|HOLD)\b/, className: "todo" },
        ...HEADLINE,
      ],
      end: /$/,
    })),
    ...sourceBlocks(hljs),
    {
      begin: /^[ \t]*#\+(begin|BEGIN)_\w+.*$/,
      beginScope: "meta",
      end: /^[ \t]*#\+(end|END)_\w+/,
      endScope: "meta",
    },
    { begin: /^#\+(title|TITLE):/, className: "meta", starts: value("title") },
    { begin: /^[ \t]*#\+\w+:/, className: "meta", starts: value("string") },
    { begin: /^[ \t]*#( .*)?$/, className: "comment" },
    { begin: /^[ \t]*:[\w-]+:(?=[ \t]*$)/, className: "meta" },
    { begin: /^[ \t]*:[\w-]+\+?:/, className: "attr", starts: value("string") },
    { begin: /^[ \t]*\|[-+]+\|?[ \t]*$/, className: "punctuation" },
    {
      begin: /^[ \t]*\|/,
      beginScope: "punctuation",
      className: "table",
      contains: [{ begin: /\|/, className: "punctuation" }, ...INLINE],
      end: /$/,
    },
    { begin: /^[ \t]*-{5,}[ \t]*$/, className: "punctuation" },
    { begin: /^[ \t]*([-+]|\d+[.)])[ \t]+/, className: "bullet" },
    { begin: /\b(SCHEDULED|DEADLINE|CLOSED|CLOCK):/, className: "keyword" },
    { begin: /\[[ X-]\]/, className: "literal" },
    ...INLINE,
  ],
});

/**
 * Text set off by `marker` the way Org reads it: the marker after the start of
 * a line, a space or an opening bracket, and before its end, a space or
 * punctuation, with no space just inside either one.
 */
const emphasis = (marker: string): RegExp => {
  const m = `\\${marker}`;
  return new RegExp(
    `(?<=^|[\\s({'"])${m}[^\\s${m}](?:[^\\n${m}]*[^\\s${m}])?${m}(?=$|[\\s.,;:!?)}'"-])`,
  );
};

// Markup a line can carry anywhere, a headline's and a table's included. Below
// `emphasis`, because it is built as the module loads.
const INLINE = [
  { begin: /[<[]\d{4}-\d{2}-\d{2}[^>\]\n]*[>\]]/, className: "number" },
  { begin: /\[\[[^\]\n]+\](\[[^\]\n]+\])?\]/, className: "link" },
  { begin: /\[fn:[^\]\n]*\]/, className: "link" },
  { begin: /\[\d*(%|\/\d*)\]/, className: "literal" },
  ...(
    [
      ["*", "strong"],
      ["/", "emphasis"],
      ["=", "string"],
      ["~", "string"],
      ["+", "deletion"],
    ] as const
  ).map(([marker, className]) => ({
    begin: emphasis(marker),
    className,
  })),
];

// What a headline carries after its keyword, whatever its level.
const HEADLINE = [
  { begin: /\[#[A-Z0-9]\]/, className: "priority" },
  { begin: /(?<=\s):([\w@#%]+:)+(?=[ \t]*$)/, className: "tag" },
  ...INLINE,
];

/** The rest of a line after a keyword or a property, lit as `className`. */
const value = (className: string) => ({
  contains: [{ begin: /\S.*/, className }],
  end: /$/,
});

/**
 * A source block for each language registered, by its name or any alias, its
 * body lit in that language.
 */
const sourceBlocks = (hljs: Api) =>
  hljs.listLanguages().map((name) => ({
    begin: new RegExp(
      `^[ \\t]*#\\+(begin|BEGIN)_(src|SRC)[ \\t]+(${namesOf(hljs, name)
        .map(literally)
        .join("|")})(?=[ \\t]|$).*$`,
    ),
    beginScope: "meta",
    end: /^[ \t]*#\+(end|END)_(src|SRC)/,
    endScope: "meta",
    subLanguage: name,
  }));

const namesOf = (hljs: Api, name: string): readonly string[] => {
  const language = hljs.getLanguage(name);
  if (language === undefined) {
    throw new Error(`a listed language is not registered: ${name}`);
  } else {
    return [name, ...(language.aliases ?? [])];
  }
};

const literally = (name: string): string =>
  name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
