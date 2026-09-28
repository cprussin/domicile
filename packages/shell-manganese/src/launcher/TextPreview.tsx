import { useMemo } from "react";

import { css } from "../../styled-system/css";
import { highlight, languageOf } from "./highlight";

/**
 * The front of a text file, each line numbered and lit by what a grammar
 * says each piece of it is — or plain, for a file no grammar is for.
 *
 * What each piece looks like is said here in the desktop's own colors rather
 * than a highlighting theme's, so one set of rules reads on a light desk and a
 * dark one alike: the tokens flip, and the highlighting follows.
 */
export const TextPreview = ({ path, text }: { path: string; text: string }) => {
  const lines = useMemo(() => highlight(languageOf(path), text), [path, text]);
  return (
    <pre className={codeStyles}>
      {lines.map((runs, line) => (
        // The line's number as its key, because that is what it is.
        <span className={lineStyles} key={line}>
          {/* A newline for a line with nothing on it, which would otherwise
              be a block with no height and no line at all. */}
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

// Selectable where nothing else in the shell is: this is somebody's file
// rather than the shell's own words, and a line of it may be why they looked.
//
// Six hues is what the desktop has — its accent, its three statuses, its
// foreground and a quieter one — so a grammar's dozens of words come down to
// what a reader tells apart at a glance: what the language says, what the
// program says, what it computes with, and what nobody runs.
const codeStyles = css({
  "& [data-scope=addition]": { color: "success" },
  "& [data-scope=attr], & [data-scope=attribute], & [data-scope=property], & [data-scope=variable], & [data-scope=template-variable], & [data-scope=params]":
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
  "& [data-scope=emphasis]": { fontStyle: "italic" },
  "& [data-scope=keyword], & [data-scope=selector-tag], & [data-scope=doctag], & [data-scope=name]":
    { color: "accent" },
  "& [data-scope=number], & [data-scope=literal], & [data-scope=symbol], & [data-scope=bullet], & [data-scope=link]":
    { color: "warning" },
  "& [data-scope=regexp], & [data-scope=string], & [data-scope=char]": {
    color: "success",
  },
  "& [data-scope=section], & [data-scope=title]": {
    color: "foreground",
    fontWeight: "semibold",
  },
  "& [data-scope=strong]": { fontWeight: "bold" },
  blockSize: "100%",
  counterReset: "line",
  fontFamily: "mono",
  fontSize: "sm",
  lineHeight: "normal",
  margin: 0,
  overflow: "hidden",
  paddingBlock: 3,
  userSelect: "text",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

// A line with its number in a gutter of its own: the number counted by the
// stylesheet, so it is never text a copy would pick up, and set in the line's
// start padding, so a line that wraps comes back to the code's edge rather
// than under the number.
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
