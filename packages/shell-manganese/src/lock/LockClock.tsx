import { css } from "../../styled-system/css";
import { vstack } from "../../styled-system/patterns";
import type { wallClock } from "../clock/useNow";
import { useNow } from "../clock/useNow";

/** The locale the day is named in, fixed for the top bar's reason — see `clock/reading.ts`. */
const LOCALE = "en-US";

/** How wide the hour and the minute are written. */
const DIGITS = 2;

type Props = {
  now?: typeof wallClock | undefined;
};

/**
 * The time, large, over a locked desk: the one thing somebody walking up to it
 * wants to know before whether it is theirs.
 */
export const LockClock = ({ now }: Props) => {
  const time = useNow(now);

  return (
    <time className={clockStyles} dateTime={time.toISOString()}>
      <span className={hourStyles}>{hour(time)}</span>
      <span className={dayStyles}>{day(time)}</span>
    </time>
  );
};

const hour = (now: Date): string =>
  [now.getHours(), now.getMinutes()]
    .map((value) => value.toString().padStart(DIGITS, "0"))
    .join(":");

const day = (now: Date): string =>
  now.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

// Drawn straight onto the blurred desktop rather than onto the pane, so it
// takes the photograph's text shadow: what is behind it is whatever was on the
// screen, and that may be white behind any given stroke.
const clockStyles = vstack({
  color: "foreground",
  gap: 1,
  textShadow: "textOverPhoto",
});

const hourStyles = css({
  fontSize: "8xl",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "extralight",
  letterSpacing: "tighter",
  lineHeight: "none",
});

const dayStyles = css({
  color: "color-mix(in oklab, {colors.foreground} 80%, transparent)",
  fontSize: "lg",
  fontWeight: "medium",
  letterSpacing: "wide",
});
