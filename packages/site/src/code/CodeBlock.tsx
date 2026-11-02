import { css, cva, cx } from "../../styled-system/css";
import { CopyButton } from "./CopyButton";
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
  /** Show a button that copies `code`, beside the code, never over it. */
  copy?: boolean | undefined;
};

/** Highlighted code, colored at build time. */
export const CodeBlock = ({
  code,
  language,
  frame = "inset",
  copy = false,
}: Props) => {
  const lines = <HighlightedLines code={code} language={language} />;
  return copy ? (
    <div className={cx(frameStyles({ frame }), copyableStyles)}>
      <pre className={preStyles}>{lines}</pre>
      <CopyButton text={code} />
    </div>
  ) : (
    <pre className={cx(frameStyles({ frame }), preStyles)}>{lines}</pre>
  );
};

const frameStyles = cva({
  base: {
    backgroundColor: "syntax.ground",
    color: "syntax.plain",
    fontFamily: "code",
    fontSize: "sm",
    lineHeight: "relaxed",
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

const preStyles = css({ margin: 0, minInlineSize: 0, overflowX: "auto" });

// The button takes its own column, so it can't cover code or the scrollbar.
const copyableStyles = css({
  alignItems: "start",
  columnGap: 3,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
});
