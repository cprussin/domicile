import { Fragment } from "react";

import { css } from "../../styled-system/css";
import { marked } from "./match-runs";
import "../stylesheet";

type Props = {
  query: string;
  text: string;
};

/**
 * A row's text with what `query` matched in bold, so users see why it
 * matched. Uses `mark` for its semantics, which screen readers understand.
 */
export const Marked = ({ query, text }: Props) => (
  <>
    {marked(text, query).map((run, at) =>
      run.matched ? (
        // Runs have no identity beyond their position.
        <mark className={markStyles} key={at}>
          {run.text}
        </mark>
      ) : (
        <Fragment key={at}>{run.text}</Fragment>
      ),
    )}
  </>
);

// In the row's own color instead of `mark`'s yellow. Emboldened with a
// stroke rather than font weight, which would widen letters and shift the
// row on every key. `paint-order: stroke` keeps letter holes open.
const markStyles = css({
  backgroundColor: "transparent",
  color: "inherit",
  paintOrder: "stroke",
  WebkitTextStroke: "{borderWidths.fauxBold} currentColor",
});
