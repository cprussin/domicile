import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { SQUARES_REGULAR } from "../_icon/phosphor-parts";

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
        hoverStyles={squareSpreadStyles}
        key={d}
        name="square"
        order={index}
        stateStyles={SQUARE_STYLES[index]}
      />
    ))}
  </IconFrame>
);

const squareSpreadStyles = css({
  _controlHover: {
    animation:
      "iconSquareSpread {durations.slowest} {easings.in-out} calc(var(--part-order) * {durations.fastest} / 2)",
  },
});

// Each square moves along its own diagonal, out while pointed at and in
// while pressed: top start, top end, bottom start, bottom end. Physical,
// since the icon does not mirror.
const SQUARE_STYLES = [
  css({
    _controlActive: { transform: "translate(5px, 5px)" },
    "--spread-x": "-9px",
    "--spread-y": "-9px",
    transition: "transform {durations.fast} {easings.out}",
  }),
  css({
    _controlActive: { transform: "translate(-5px, 5px)" },
    "--spread-x": "9px",
    "--spread-y": "-9px",
    transition: "transform {durations.fast} {easings.out}",
  }),
  css({
    _controlActive: { transform: "translate(5px, -5px)" },
    "--spread-x": "-9px",
    "--spread-y": "9px",
    transition: "transform {durations.fast} {easings.out}",
  }),
  css({
    _controlActive: { transform: "translate(-5px, -5px)" },
    "--spread-x": "9px",
    "--spread-y": "9px",
    transition: "transform {durations.fast} {easings.out}",
  }),
];
