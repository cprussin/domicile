import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

export const Kbd = (props: ExtendProps<"kbd">) => (
  <kbd {...props} className={kbdStyles} />
);

/**
 * Kbd intentionally uses `em` units for sizing rather than the spacing-token
 * scale. The chip is meant to sit inline with surrounding text and stay
 * proportional to it whether it's rendered inside body copy, a heading, or a
 * footnote — see the `AllVariations` story which embeds Kbd at every
 * `fontSize` token to verify. This is the documented exception to the
 * tokens-required rule.
 */
const kbdStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.borderStrong}",
  borderRadius: "0.25em",
  color: "muted",
  fontFamily: "mono",
  fontSize: "0.8em",
  paddingBlock: "0.1em",
  paddingInline: "0.25em",
});
