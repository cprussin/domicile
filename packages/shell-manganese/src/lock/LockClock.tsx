import { css } from "../../styled-system/css";
import { vstack } from "../../styled-system/patterns";
import type { wallClock } from "../clock/useNow";
import { useNow } from "../clock/useNow";

/** The locale for the date; fixed for the reason in `clock/reading.ts`. */
const LOCALE = "en-US";

/** The hour and minute format. */
const DIGITS = 2;

type Props = {
  now?: typeof wallClock | undefined;
};

/** The large clock on the lock screen. */
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

// Drawn on the blurred desktop, not the pane, so it needs a text shadow: the
// background may be white.
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
