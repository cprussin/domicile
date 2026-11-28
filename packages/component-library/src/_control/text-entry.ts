import { css } from "../../styled-system/css";

/**
 * The text box inside a control's wrapper, as in Input and Autocomplete: it
 * fills the row, draws no box of its own (the wrapper does) and ellipsizes
 * what doesn't fit.
 */
export const textEntryStyles = css({
  "&::placeholder": { color: "muted" },
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "text" },
  flexGrow: 1,
  inlineSize: "100%",
  minInlineSize: 0,
  outlineStyle: "none",
  padding: 0,
  textOverflow: "ellipsis",
});
