import { useEffect, useState } from "react";

import { css } from "../styled-system/css";

/** The wall clock the display reads; a parameter so tests can hold it. */
const wallClock = (): Date => new Date();

const TICK_INTERVAL_MS = 1000;

type Props = {
  now?: typeof wallClock | undefined;
};

/**
 * A tiny bit of live chrome, to prove ordinary CSS and JS run in the shell.
 */
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
      {time.toLocaleTimeString()}
    </time>
  );
};

const clockStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
