import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";

/** A detail's value: one line, or several, each on its own line. */
export type Value = string | readonly string[];

/** A connection's details, each a term and its value, in a panel. */
export const Details = ({
  rows,
}: {
  rows: readonly (readonly [string, Value])[];
}) => (
  <dl className={detailsStyles}>
    {rows.map(([term, value]) => (
      <div className={detailStyles} key={term}>
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

const detailsStyles = flex({
  direction: "column",
  gap: 0.5,
  margin: 0,
});

const detailStyles = hstack({
  gap: 2,
  justify: "space-between",
});

const termStyles = css({ flexShrink: 0, opacity: 0.75 });

const valueStyles = css({
  margin: 0,
  overflowWrap: "anywhere",
  textAlign: "end",
});

const lineStyles = css({ display: "block" });
