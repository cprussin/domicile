import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { reading } from "./reading";

/** The wall clock the display reads; injected so tests can hold it still. */
const wallClock = (): Date => new Date();

/** A reading is good for a second, so the clock is read every second. */
const TICK_INTERVAL_MS = 1000;

type Props = {
  now?: typeof wallClock | undefined;
};

/** The live clock: in the middle of the top bar, and alone on every other screen. */
export const Clock = ({ now = wallClock }: Props) => {
  const [time, setTime] = useState(() => now());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(now());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [now]);

  return (
    <time className={clockStyles} dateTime={time.toISOString()}>
      {reading(time)}
    </time>
  );
};

// No colour of its own: in the top bar it takes the white the bar draws its
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
