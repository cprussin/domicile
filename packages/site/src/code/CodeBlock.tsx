import { cva } from "../../styled-system/css";
import { HighlightedLines } from "./HighlightedLines";
import type { Language } from "./highlight";

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
    <HighlightedLines code={code} language={language} />
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
