import { css } from "../styled-system/css";

/**
 * What every window on the stage shares: it fills the stage, and the one that
 * is not on it has no box at all.
 *
 * A background is not among them. A window that shows a client's surface must
 * not paint one: where the compositor draws that surface itself the element is
 * a hole in the page, and a background here would fill the hole in and hide the
 * window behind it. A window that draws its own contents sets its own.
 *
 * `display` is not among them either. A window that lays its own
 * contents out has to set it, and two atomic classes on one element tie on
 * specificity — so a `display` here silently beats the window's own wherever
 * the bundle happens to order the two rules. Absolute positioning blockifies
 * the box anyway, which is all a window that sets no `display` ever wanted.
 *
 * Published as a `css(...)` className rather than a style object because a
 * cross-file object spread into another package-local `css`/`cva` call is
 * opaque to Panda's static extractor — the classes come out with no rules
 * behind them. Consumers compose it with `cx(...)`.
 */
export const windowStyles = css({
  // A window's own `display` would otherwise beat the `hidden` attribute's UA
  // rule; this selector outranks it.
  "&[hidden]": { display: "none" },
  inset: 0,
  position: "absolute",
});
