import { cva } from "../../styled-system/css";
import "../stylesheet";

/** The highest count the badge shows before it switches to "N+". */
const MOST_COUNTED = 9;

/** The same, in line with text, where the pill can widen. */
const MOST_COUNTED_INLINE = 99;

type Props = {
  /** How many are unread. Zero draws nothing. */
  count: number;
  /** In line with text, such as at a row's end, rather than on a corner. */
  inline?: boolean | undefined;
};

/**
 * An unread count in an accent pill, pinned to the top end corner of the
 * nearest positioned ancestor, or in line with text. It pops in when it
 * appears.
 *
 * Hidden from assistive tech: the control it sits on names the count.
 */
export const CountBadge = ({ count, inline = false }: Props) => {
  const most = inline ? MOST_COUNTED_INLINE : MOST_COUNTED;
  return count === 0 ? undefined : (
    <span
      aria-hidden
      className={badgeStyles({ inline })}
      data-inline={inline ? "" : undefined}
    >
      {count > most ? `${most.toString()}+` : count}
    </span>
  );
};

// The bar's text shadow is removed because it smudges small figures.
const badgeStyles = cva({
  base: {
    _starting: {
      transform: "scale(0)",
    },
    alignItems: "center",
    backgroundColor: "accent",
    borderRadius: "full",
    color: "background",
    display: "inline-flex",
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
    fontWeight: "bold",
    justifyContent: "center",
    lineHeight: "none",
    pointerEvents: "none",
    textShadow: "none",
    transform: "scale(1)",
    transition: "transform {durations.normal} {easings.outBack}",
  },
  variants: {
    inline: {
      false: {
        blockSize: 3.5,
        boxShadow: "lifted",
        fontSize: "0.5625rem",
        insetBlockStart: 0,
        insetInlineEnd: 0,
        minInlineSize: 3.5,
        paddingInline: 0.75,
        position: "absolute",
      },
      // Larger, as it sits beside text of its own size.
      true: {
        blockSize: 4.5,
        fontSize: "xs",
        minInlineSize: 4.5,
        paddingInline: 1.5,
      },
    },
  },
});
