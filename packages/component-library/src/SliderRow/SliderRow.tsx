import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import "../stylesheet";

type Props = {
  /** The slider. */
  children: ReactNode;
  /** A button at the end, such as an arrow to more controls. */
  end?: ReactNode | undefined;
  /** The value, such as `70%`. */
  figure: string;
  /** An icon or a button before the slider, in an `IconButton`'s room. */
  lead: ReactNode;
};

/**
 * A slider in a row: what it sets, the slider, its value, and optionally a
 * button. Rows stacked in a panel line up, since the lead and the figure
 * keep a set width.
 */
export const SliderRow = ({ children, end, figure, lead }: Props) => (
  <span className={rowStyles}>
    <span className={leadStyles}>{lead}</span>
    <span className={sliderStyles}>{children}</span>
    <span className={figureStyles}>{figure}</span>
    {end}
  </span>
);

const rowStyles = hstack({ gap: 2, inlineSize: "100%" });

const leadStyles = hstack({
  flexShrink: 0,
  inlineSize: 6,
  justify: "center",
});

// Room for half the thumb at either end, so at 0% or 100% it clears the
// lead and the figure.
const sliderStyles = hstack({ flex: 1, minInlineSize: 0, paddingInline: 1.5 });

const figureStyles = css({
  color: "textSoft",
  flexShrink: 0,
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 9,
  textAlign: "end",
  textStyle: "panelDetail",
});
