import { css, cva } from "../../styled-system/css";
import type { Language } from "./highlight";
import { highlight } from "./highlight";

type Props = {
  code: string;
  language: Language;
  /**
   * `inset` sits inside a card, `panel` stands on its own, and `bare` has no
   * frame, for several blocks in one panel.
   */
  frame?: "bare" | "inset" | "panel" | undefined;
};

/** Highlighted code, colored at build time. */
export const CodeBlock = ({ code, language, frame = "inset" }: Props) => (
  <pre className={preStyles({ frame })}>
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
  </pre>
);

const preStyles = cva({
  base: {
    backgroundColor: "syntax.ground",
    color: "syntax.plain",
    fontFamily: "code",
    fontSize: "sm",
    lineHeight: "relaxed",
    margin: 0,
    overflowX: "auto",
  },
  variants: {
    frame: {
      bare: {},
      inset: {
        border: "1px solid {colors.border}",
        borderRadius: "lg",
        paddingBlock: 4,
        paddingInline: 4.5,
      },
      panel: {
        border: "1px solid {colors.border}",
        borderRadius: "2xl",
        padding: 6,
      },
    },
  },
});

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
