import { css } from "../../styled-system/css";
import { reading } from "./reading";
import type { wallClock } from "./useNow";
import { useNow } from "./useNow";

type Props = {
  now?: typeof wallClock | undefined;
};

/** The live clock: in the middle of the top bar, and alone on every other screen. */
export const Clock = ({ now }: Props) => {
  const time = useNow(now);

  return (
    <time className={clockStyles} dateTime={time.toISOString()}>
      {reading(time)}
    </time>
  );
};

// No color of its own: in the top bar it takes the white the bar draws its
// text in, and on a screen with no bar it takes the page's own foreground.
const clockStyles = css({
  // Ten pixels, which is what the desktop asks for and what no font-size token
  // is: the scale steps from 8px to 12px. A rem rather than a px literal, the
  // way every other off-scale length in this repo is written.
  fontSize: "0.625rem",
  // A reading that changes every second must not change width every second,
  // or the bar it is centered in jitters through every minute.
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});
