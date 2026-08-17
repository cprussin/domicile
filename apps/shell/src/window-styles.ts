import { css } from "../styled-system/css";

/**
 * What every window on the stage shares: it fills the stage, and the one that
 * is not on it has no box at all.
 *
 * Published as a `css(...)` className rather than a style object because a
 * cross-file object spread into another package-local `css`/`cva` call is
 * opaque to Panda's static extractor — the classes come out with no rules
 * behind them. Consumers compose it with `cx(...)`.
 */
export const windowStyles = css({
  // `display` below would otherwise beat the `hidden` attribute's UA rule.
  "&[hidden]": { display: "none" },
  backgroundColor: "background",
  display: "block",
  inset: 0,
  position: "absolute",
});
