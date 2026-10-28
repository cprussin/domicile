"use client";

import type { KeyboardEvent } from "react";
import { useRef } from "react";

import { css } from "../../styled-system/css";
import { HighlightedLines } from "../code/HighlightedLines";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/**
 * A code editor: a textarea over its own text, highlighted. The textarea's
 * text is transparent, so the highlighted copy shows through, and its caret
 * and selection stay.
 */
export const CodeEditor = ({ label, value, onChange }: Props) => {
  const lines = useRef<HTMLPreElement>(null);
  return (
    <div className={frameStyles}>
      <pre aria-hidden className={linesStyles} ref={lines}>
        {/* A last newline, so a trailing empty line has a height. */}
        <HighlightedLines code={`${value}\n`} language="tsx" />
      </pre>
      <textarea
        aria-label={label}
        autoCapitalize="off"
        autoComplete="off"
        className={inputStyles}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          indentOnTab(event, onChange);
        }}
        onScroll={(event) => {
          lines.current?.scrollTo(
            event.currentTarget.scrollLeft,
            event.currentTarget.scrollTop,
          );
        }}
        spellCheck={false}
        value={value}
      />
    </div>
  );
};

/** Tab indents, as in an editor, instead of leaving the textarea. */
const indentOnTab = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  onChange: (value: string) => void,
) => {
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    const area = event.currentTarget;
    area.setRangeText("  ", area.selectionStart, area.selectionEnd, "end");
    onChange(area.value);
  }
};

const frameStyles = css({
  backgroundColor: "syntax.ground",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  display: "grid",
  inlineSize: "100%",
  overflow: "hidden",
  position: "relative",
});

// The highlighted text and the textarea share one cell and one font, so they
// line up glyph for glyph.
const layer = {
  fontFamily: "code",
  fontSize: "sm",
  gridArea: "1 / 1",
  lineHeight: "relaxed",
  margin: 0,
  paddingBlock: 5,
  paddingInline: 6,
  tabSize: 2,
  whiteSpace: "pre",
} as const;

const linesStyles = css({
  ...layer,
  color: "syntax.plain",
  overflow: "hidden",
  pointerEvents: "none",
});

const inputStyles = css({
  ...layer,
  _focusVisible: {
    outline: "2px solid {colors.accent}",
    outlineOffset: "-2px",
  },
  _selection: {
    backgroundColor: "color-mix(in oklab, {colors.accent} 35%, transparent)",
  },
  backgroundColor: "transparent",
  border: "none",
  caretColor: "{colors.syntax.plain}",
  color: "transparent",
  overflow: "auto",
  resize: "none",
});
