import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

type Props = {
  /** What the notice is about, such as the label's new value. */
  children: ReactNode;
  /** Drawn before the label. */
  icon: ReactNode;
  /** A level from 0 to 1, drawn as a meter after the label. */
  level?: number | undefined;
  /** Grays the meter, such as for muted audio. */
  muted?: boolean | undefined;
};

/**
 * A pill that briefly shows a change, such as a new zoom level or volume, then
 * fades out.
 *
 * It hides on `animationend`, not a timer, so the duration lives only in the
 * stylesheet. Key it per change to show it again. The caller positions it; it
 * ignores the pointer so it never blocks what is under it.
 */
export const Notice = ({ children, icon, level, muted }: Props) => {
  const [showing, setShowing] = useState(true);

  return showing ? (
    <output
      className={noticeStyles}
      onAnimationEnd={() => {
        setShowing(false);
      }}
    >
      {icon}
      {children}
      {level === undefined ? undefined : (
        <span
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(level * 100)}
          className={meterStyles}
          data-muted={muted === true ? "" : undefined}
          role="meter"
          // Inline because the level is a runtime value Panda cannot extract.
          style={{ "--notice-level": level } as CSSProperties}
        />
      )}
    </output>
  ) : undefined;
};

// Appears quickly, holds long enough to read, then fades out.
const noticeStyles = hstack({
  animation: "noticeShown {durations.notice} {easings.out} forwards",
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "full",
  boxShadow: "lifted",
  color: "foreground",
  fontSize: "sm",
  fontVariantNumeric: "tabular-nums",
  gap: 2,
  paddingBlock: 1.5,
  paddingInline: 3,
  pointerEvents: "none",
});

// A track with the level filled from the start edge. The fill is a scaled
// pseudo-element so the level can change without layout.
const meterStyles = css({
  "&::after": {
    backgroundColor: "accent",
    borderRadius: "full",
    content: '""',
    inset: 0,
    position: "absolute",
    transform: "scaleX(var(--notice-level))",
    transformOrigin: "left",
  },
  "&[data-muted]::after": {
    backgroundColor: "muted",
  },
  backgroundColor: "border",
  blockSize: 1,
  borderRadius: "full",
  inlineSize: 24,
  overflow: "hidden",
  position: "relative",
});
