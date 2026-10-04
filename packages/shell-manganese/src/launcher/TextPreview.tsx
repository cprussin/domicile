import { useMemo } from "react";

import { css } from "../../styled-system/css";
import { highlight, languageOf } from "./highlight";

/**
 * The start of a text file with line numbers and syntax highlighting, or plain
 * when no grammar matches.
 *
 * Uses the desktop's semantic colors rather than a highlighting theme, so it
 * works in light and dark mode.
 */
export const TextPreview = ({ path, text }: { path: string; text: string }) => {
  const lines = useMemo(() => highlight(languageOf(path), text), [path, text]);
  return (
    <pre className={codeStyles}>
      {lines.map((runs, line) => (
        // Line numbers are stable keys.
        <span className={lineStyles} key={line}>
          {/* A newline keeps an empty line from collapsing to zero height. */}
          {runs.length === 0
            ? "\n"
            : runs.map((run, at) => (
                <span data-scope={run.scope} key={at}>
                  {run.text}
                </span>
              ))}
        </span>
      ))}
    </pre>
  );
};

// The desktop has six hues (accent, three statuses, foreground and muted), so
// token scopes map to a few groups: keywords, literals, names, and comments.
// Org scopes follow Emacs's faces: a hue per headline level, TODO in red, DONE
// in green, and done headlines muted.
const codeStyles = css({
  "& [data-scope=addition]": { color: "success" },
  "& [data-scope=attr], & [data-scope=attribute], & [data-scope=property], & [data-scope=variable], & [data-scope=template-variable], & [data-scope=params], & [data-scope=table]":
    {
      color: "color-mix(in oklab, {colors.accent} 55%, {colors.foreground})",
    },
  "& [data-scope=built_in], & [data-scope=type], & [data-scope=class]": {
    color: "color-mix(in oklab, {colors.warning} 60%, {colors.danger})",
  },
  "& [data-scope=comment], & [data-scope=quote]": {
    color: "muted",
    fontStyle: "italic",
  },
  "& [data-scope=deletion], & [data-scope=meta]": { color: "danger" },
  "& [data-scope=done]": { color: "success", fontWeight: "bold" },
  "& [data-scope=emphasis]": { fontStyle: "italic" },
  "& [data-scope=heading-1]": { color: "accent", fontWeight: "semibold" },
  "& [data-scope=heading-2]": {
    color: "color-mix(in oklab, {colors.warning} 60%, {colors.danger})",
    fontWeight: "semibold",
  },
  "& [data-scope=heading-3]": { color: "success", fontWeight: "semibold" },
  "& [data-scope=heading-4]": {
    color: "color-mix(in oklab, {colors.accent} 55%, {colors.foreground})",
    fontWeight: "semibold",
  },
  "& [data-scope=heading-done], & [data-scope=punctuation], & [data-scope=tag]":
    { color: "muted" },
  "& [data-scope=keyword], & [data-scope=selector-tag], & [data-scope=doctag], & [data-scope=name]":
    { color: "accent" },
  "& [data-scope=number], & [data-scope=literal], & [data-scope=symbol], & [data-scope=bullet], & [data-scope=link]":
    { color: "warning" },
  "& [data-scope=priority]": { color: "warning", fontWeight: "bold" },
  "& [data-scope=regexp], & [data-scope=string], & [data-scope=char]": {
    color: "success",
  },
  "& [data-scope=section], & [data-scope=title]": {
    color: "foreground",
    fontWeight: "semibold",
  },
  "& [data-scope=strong]": { fontWeight: "bold" },
  "& [data-scope=todo]": { color: "danger", fontWeight: "bold" },
  counterReset: "line",
  fontFamily: "mono",
  fontSize: "sm",
  lineHeight: "normal",
  margin: 0,
  paddingBlock: 3,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

// The line number is a CSS counter, so copying text skips it. It sits in the
// start padding, so wrapped lines align with the code, not the number.
const lineStyles = css({
  _before: {
    color: "color-mix(in oklab, {colors.muted} 60%, transparent)",
    content: "counter(line)",
    counterIncrement: "line",
    fontVariantNumeric: "tabular-nums",
    inlineSize: 8,
    insetInlineStart: 0,
    position: "absolute",
    textAlign: "end",
    userSelect: "none",
  },
  display: "block",
  paddingInlineEnd: 3,
  paddingInlineStart: 11,
  position: "relative",
});
