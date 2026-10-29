import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { grid, hstack } from "../../styled-system/patterns";
import { AnimatedCheckIcon } from "../AnimatedCheckIcon/AnimatedCheckIcon";
import { IconButton } from "../IconButton/IconButton";

/** How long a copy button shows its check. */
const COPIED_MS = 1500;

/** A detail's value: one line, or several, each on its own line. */
export type DetailValue = string | readonly string[];

/** How a detail's value is offered. */
export type DetailOptions = {
  /** Give each line a button that copies it, for an address or a name. */
  copyable?: boolean | undefined;
};

/** A term and its value. */
export type Detail = readonly [
  term: string,
  value: DetailValue,
  options?: DetailOptions,
];

/**
 * Terms and their values in two columns, such as a connection's addresses.
 * A long value wraps within its column, so it never widens the panel.
 * Values can be selected; a copyable one has a copy button on each line,
 * shown while the pointer is on that line.
 */
export const DetailList = ({ rows }: { rows: readonly Detail[] }) => (
  <dl className={listStyles}>
    {rows.map(([term, value, options]) => (
      <div className={rowStyles} key={term}>
        <dt className={termStyles}>{term}</dt>
        <dd className={valueStyles}>
          {linesOf(value).map((line) => (
            <span className={lineStyles} data-detail-line="" key={line}>
              <span className={textStyles}>{line}</span>
              {options?.copyable === true && <CopyButton text={line} />}
            </span>
          ))}
        </dd>
      </div>
    ))}
  </dl>
);

/** Copies `text`, then shows a check for a moment. */
const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = copied
      ? setTimeout(() => {
          setCopied(false);
        }, COPIED_MS)
      : undefined;
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <span className={copyStyles} data-copied={copied ? "" : undefined}>
      <IconButton
        label={`${copied ? "Copied" : "Copy"} ${text}`}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
            },
            (error: unknown) => {
              // biome-ignore lint/suspicious/noConsole: surfacing a failed copy
              console.error(`Failed to copy ${text}`, error);
            },
          );
        }}
        size="sm"
      >
        {copied ? (
          <AnimatedCheckIcon size={12} />
        ) : (
          <CopyIcon aria-hidden size={12} weight="bold" />
        )}
      </IconButton>
    </span>
  );
};

// Each row is a subgrid, so every value starts at the longest term's end.
const listStyles = grid({
  columnGap: 3,
  gridTemplateColumns: "max-content minmax(0, 1fr)",
  margin: 0,
  rowGap: 0.5,
  textStyle: "panelDetail",
});

const rowStyles = css({
  display: "grid",
  gridColumn: "1 / -1",
  gridTemplateColumns: "subgrid",
});

const termStyles = css({ color: "textSoft" });

// The shell turns selection off; a value is something to select.
const valueStyles = css({
  fontVariantNumeric: "tabular-nums",
  margin: 0,
  overflowWrap: "anywhere",
  userSelect: "text",
});

const lineStyles = hstack({ alignItems: "center", gap: 1 });

const textStyles = css({ minInlineSize: 0 });

// Hidden until the pointer is on its line, so a column of buttons doesn't
// crowd the values. The negative margin keeps the line as tall as its text.
const copyStyles = css({
  "&:has(:focus-visible), [data-detail-line]:hover &, &[data-copied]": {
    opacity: 1,
  },
  display: "inline-flex",
  flexShrink: 0,
  marginBlock: "-0.5",
  opacity: 0,
  transition: "opacity {durations.fast} {easings.default}",
  userSelect: "none",
});

const linesOf = (value: DetailValue): readonly string[] =>
  typeof value === "string" ? [value] : value;
