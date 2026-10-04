import { Slider as BaseSlider } from "@base-ui/react/slider";

import { css } from "../../styled-system/css";

type Props = Omit<
  BaseSlider.Root.Props<number>,
  "children" | "className" | "style"
> & {
  /** Accessible name for the thumb. */
  label: string;
  /**
   * A live level from 0 to 1, drawn as a meter under the track, such as
   * current audio volume. Omit for no meter.
   */
  level?: number | undefined;
};

/**
 * A single-value slider over base-ui's Slider. Drawn in `currentcolor` so it
 * fits any background.
 */
export const Slider = ({ label, level, ...rootProps }: Props) => (
  <BaseSlider.Root className={rootStyles} {...rootProps}>
    <BaseSlider.Control className={controlStyles}>
      <BaseSlider.Track className={trackStyles}>
        <BaseSlider.Indicator className={indicatorStyles} />
        <BaseSlider.Thumb aria-label={label} className={thumbStyles} />
      </BaseSlider.Track>
      {level !== undefined && <Meter label={label} level={level} />}
    </BaseSlider.Control>
  </BaseSlider.Root>
);

/**
 * The level meter: a thin green line under the track, so it isn't mistaken
 * for a second slider.
 */
const Meter = ({ label, level }: { label: string; level: number }) => {
  const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <span
      aria-label={`${label} level`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={meterStyles}
      role="meter"
    >
      <span className={meterFillStyles} style={{ inlineSize: `${percent}%` }} />
    </span>
  );
};

// Fills the remaining row space instead of shrinking to its empty content.
const rootStyles = css({
  flexGrow: 1,
  inlineSize: "100%",
});

// Taller than the track, for a larger hit area.
const controlStyles = css({
  alignItems: "center",
  blockSize: 5,
  cursor: "pointer",
  display: "flex",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

const meterStyles = css({
  backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  blockSize: "2px",
  borderRadius: "full",
  insetBlockEnd: 0,
  insetInline: 0,
  overflow: "hidden",
  pointerEvents: "none",
  position: "absolute",
});

// A short transition, since levels arrive twenty times a second.
const meterFillStyles = css({
  backgroundColor: "success",
  blockSize: "100%",
  display: "block",
  transition: "inline-size {durations.fastest} {easings.linear}",
});

const trackStyles = css({
  backgroundColor: "color-mix(in oklab, currentcolor 25%, transparent)",
  blockSize: 1,
  borderRadius: "full",
  inlineSize: "100%",
  position: "relative",
});

// Eases on jumps (track click, key, external update) but not while dragging,
// where easing would lag the pointer.
const indicatorStyles = css({
  "&:not([data-dragging])": {
    transition: "inline-size {durations.normal} {easings.outQuart}",
  },
  backgroundColor: "currentcolor",
  blockSize: "100%",
  borderRadius: "full",
});

// Uses `scale`, since base-ui positions the thumb with inline `translate`.
const thumbStyles = css({
  "&:has(:focus-visible)": {
    outline: "{spacing.0.5} solid currentcolor",
    outlineOffset: 0.5,
  },
  "&:not([data-dragging])": {
    transition:
      "inset-inline-start {durations.normal} {easings.outQuart}, scale {durations.fast} {easings.out}",
  },
  "&[data-dragging]": {
    scale: "1.15",
  },
  backgroundColor: "currentcolor",
  blockSize: 3,
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  inlineSize: 3,
});
