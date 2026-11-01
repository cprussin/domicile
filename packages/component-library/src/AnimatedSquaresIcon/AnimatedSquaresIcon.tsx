import { css } from "../../styled-system/css";
import { DIAGONALS } from "../_icon/diagonals";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { SQUARES_REGULAR } from "../_icon/phosphor-parts";
import "../stylesheet";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `SquaresFour`. Its squares part a little while the
 * control it is in is pointed at, and close in while it is pressed.
 */
export const AnimatedSquaresIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    {SQUARES_REGULAR.squares.map((d, index) => (
      <IconPart
        d={d}
        direction={DIAGONALS[index]}
        hoverStyles={squareSpreadStyles}
        key={d}
        name="square"
        order={index}
        stateStyles={squarePressStyles}
      />
    ))}
  </IconFrame>
);

const squareSpreadStyles = css({
  _controlHover: {
    animation:
      "iconPartSpread {durations.slowest} {easings.in-out} calc(var(--part-order) * {durations.fastest} / 2)",
  },
  "--spread": "9px",
});

// Each square moves in along its diagonal while pressed.
const squarePressStyles = css({
  _controlActive: {
    transform:
      "translate(calc(var(--part-x) * -5px), calc(var(--part-y) * -5px))",
  },
  transition: "transform {durations.fast} {easings.out}",
});
