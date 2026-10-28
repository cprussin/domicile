import { css } from "../../styled-system/css";
import { grid } from "../../styled-system/patterns";

/** A detail's value: one line, or several, each on its own line. */
export type DetailValue = string | readonly string[];

/** A term and its value. */
export type Detail = readonly [term: string, value: DetailValue];

/**
 * Terms and their values in two columns, such as a connection's addresses.
 * A long value wraps within its column, so it never widens the panel.
 */
export const DetailList = ({ rows }: { rows: readonly Detail[] }) => (
  <dl className={listStyles}>
    {rows.map(([term, value]) => (
      <div className={rowStyles} key={term}>
        <dt className={termStyles}>{term}</dt>
        <dd className={valueStyles}>
          {typeof value === "string"
            ? value
            : value.map((line) => (
                <span className={lineStyles} key={line}>
                  {line}
                </span>
              ))}
        </dd>
      </div>
    ))}
  </dl>
);

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

const valueStyles = css({
  fontVariantNumeric: "tabular-nums",
  margin: 0,
  overflowWrap: "anywhere",
});

const lineStyles = css({ display: "block" });
