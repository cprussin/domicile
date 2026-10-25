import { css } from "../../styled-system/css";

/** The highest count the badge shows before it switches to "N+". */
const MOST_COUNTED = 9;

type Props = {
  /** How many are unread. Zero draws nothing. */
  count: number;
};

/**
 * An unread count in an accent pill, pinned to the top end corner of the
 * nearest positioned ancestor. It pops in when it appears.
 *
 * Hidden from assistive tech: the control it sits on names the count.
 */
export const CountBadge = ({ count }: Props) =>
  count === 0 ? undefined : (
    <span aria-hidden className={badgeStyles}>
      {count > MOST_COUNTED ? `${MOST_COUNTED.toString()}+` : count}
    </span>
  );

// The bar's text shadow is removed because it smudges small figures.
const badgeStyles = css({
  _starting: {
    transform: "scale(0)",
  },
  alignItems: "center",
  backgroundColor: "accent",
  blockSize: 3.5,
  borderRadius: "full",
  boxShadow: "lifted",
  color: "background",
  display: "inline-flex",
  fontSize: "0.5625rem",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "bold",
  insetBlockStart: 0,
  insetInlineEnd: 0,
  justifyContent: "center",
  lineHeight: "none",
  minInlineSize: 3.5,
  paddingInline: 0.75,
  pointerEvents: "none",
  position: "absolute",
  textShadow: "none",
  transform: "scale(1)",
  transition: "transform {durations.normal} {easings.outBack}",
});
