import { css } from "../../styled-system/css";
import { reading } from "./reading";
import type { wallClock } from "./useNow";
import { useNow } from "./useNow";

type Props = {
  now?: typeof wallClock | undefined;
};

/** The live clock, centered in the top bar or alone on a screen without one. */
export const Clock = ({ now }: Props) => {
  const time = useNow(now);

  return (
    <time className={clockStyles} dateTime={time.toISOString()}>
      {reading(time)}
    </time>
  );
};

// No color, so it inherits the bar's white or the page's foreground.
const clockStyles = css({
  // 10px; the font-size scale jumps from 8px to 12px.
  fontSize: "0.625rem",
  // Fixed-width digits, so the bar does not jitter every second.
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});
