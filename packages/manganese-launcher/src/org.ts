// A `highlight.js` grammar for Org, which it lacks. Most scopes are the
// standard ones; Org-specific ones cover headline levels, keywords,
// priorities, tags and table cells (`heading-1`, `todo`, `table`…).

import type { common } from "lowlight";

type Grammar = (typeof common)[keyof typeof common];

type Api = Parameters<Grammar>[0];

/**
 * Org's grammar, for `lowlight.register`. Source blocks are highlighted in
 * their own language, so register it after every other language.
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
    // Org's headline faces cycle every four levels.
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
 * Org emphasis delimited by `marker`: preceded by line start, whitespace or an
 * opening bracket, followed by line end, whitespace or punctuation, with no
 * whitespace just inside the markers.
 */
const emphasis = (marker: string): RegExp => {
  const m = `\\${marker}`;
  return new RegExp(
    `(?<=^|[\\s({'"])${m}[^\\s${m}](?:[^\\n${m}]*[^\\s${m}])?${m}(?=$|[\\s.,;:!?)}'"-])`,
  );
};

// Inline markup, valid anywhere including headlines and tables. Defined after
// `emphasis` because it calls it at load time.
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

// Headline content after the keyword, at any level.
const HEADLINE = [
  { begin: /\[#[A-Z0-9]\]/, className: "priority" },
  { begin: /(?<=\s):([\w@#%]+:)+(?=[ \t]*$)/, className: "tag" },
  ...INLINE,
];

/** Highlight the rest of the line as `className`. */
const value = (className: string) => ({
  contains: [{ begin: /\S.*/, className }],
  end: /$/,
});

/** A source-block rule per registered language, matching its name or alias. */
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
