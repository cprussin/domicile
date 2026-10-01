// An Org file's grammar, which `highlight.js` has none of: its outline,
// markup and metadata, in the words the preview already lights.

import type { common } from "lowlight";

type Grammar = (typeof common)[keyof typeof common];

/** Org's grammar, for `lowlight.register`. */
export const org: Grammar = () => ({
  case_insensitive: true,
  contains: [
    {
      begin: /^\*+ /,
      className: "section",
      contains: [
        { begin: /(?<=^\*+ )(TODO|DONE)\b/, className: "keyword" },
        { begin: /(?<=\s):([\w@#%]+:)+(?=[ \t]*$)/, className: "symbol" },
        ...INLINE,
      ],
      end: /$/,
    },
    { begin: /^[ \t]*#\+\w+:?/, className: "meta" },
    { begin: /^[ \t]*#( .*)?$/, className: "comment" },
    { begin: /^[ \t]*:[\w-]+:/, className: "attr" },
    { begin: /^[ \t]*([-+]|\d+[.)])[ \t]+/, className: "bullet" },
    { begin: /\b(SCHEDULED|DEADLINE|CLOSED):/, className: "keyword" },
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

// Markup a line can carry anywhere, a headline's included. Below `emphasis`,
// because it is built as the module loads.
const INLINE = [
  { begin: /[<[]\d{4}-\d{2}-\d{2}[^>\]\n]*[>\]]/, className: "number" },
  { begin: /\[\[[^\]\n]+\](\[[^\]\n]+\])?\]/, className: "link" },
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
