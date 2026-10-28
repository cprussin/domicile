import { css, cva } from "../../styled-system/css";
import type { Language } from "./highlight";
import { highlight } from "./highlight";

type Props = { code: string; language: Language };

/** `code` as a `<code>` of highlighted lines, for a `<pre>` to frame. */
export const HighlightedLines = ({ code, language }: Props) => (
  <code>
    {highlight(language, code).map((runs, line) => (
      // Line numbers are stable keys.
      <span className={lineStyles} key={line}>
        {runs.map((run, at) => (
          <span className={runStyles({ tone: run.tone })} key={at}>
            {run.text}
          </span>
        ))}
      </span>
    ))}
  </code>
);

const lineStyles = css({ display: "block", minBlockSize: "1lh" });

const runStyles = cva({
  variants: {
    tone: {
      attr: { color: "syntax.attr" },
      comment: { color: "syntax.comment" },
      function: { color: "syntax.function" },
      keyword: { color: "syntax.keyword" },
      number: { color: "syntax.number" },
      plain: { color: "syntax.plain" },
      property: { color: "syntax.property" },
      punctuation: { color: "syntax.punctuation" },
      string: { color: "syntax.string" },
      tag: { color: "syntax.tag" },
    },
  },
});
