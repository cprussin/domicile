import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

export const Kbd = (props: ExtendProps<"kbd">) => (
  <kbd {...props} className={kbdStyles} />
);

/**
 * A keyboard key chip, inline with text.
 *
 * Sized in `em` instead of spacing tokens so it scales with the surrounding
 * text. This is the documented exception to the tokens-required rule.
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
