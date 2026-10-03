import { Slider as BaseSlider } from "@base-ui/react/slider";

import { css } from "../../styled-system/css";

type Props = Omit<
  BaseSlider.Root.Props<number>,
  "children" | "className" | "style"
> & {
  /** What the slider sets, for a screen reader: the thumb's name. */
  label: string;
  /**
   * How loud, or how full, what the slider sets is right now, 0 through 1 —
   * a meter drawn under the track, named for the slider. Absent for no meter.
   */
  level?: number | undefined;
};

/**
 * One value picked off a range: a thin track, a fill up to a round knob.
 *
 * **Drawn in `currentcolor`**, so it takes the color of whatever holds it —
 * white in a panel over the wallpaper, `foreground` in a card — the way the
 * theme toggle's icons do.
 *
 * Single-valued: a range of two thumbs is a different control and nothing here
 * asks for one. Every interaction — pointer, keyboard, the hidden range input a
 * screen reader drives — is base-ui's.
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
 * The level, as a hairline under the track: thin enough not to read as a
 * second slider, and in the slider's own color.
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

// As wide as whatever holds it, and a flex item that takes what is left of a
// row rather than shrinking to its own empty content.
const rootStyles = css({
  flexGrow: 1,
  inlineSize: "100%",
});

// Taller than the track, so the whole band around the line takes the press.
const controlStyles = css({
  alignItems: "center",
  blockSize: 5,
  cursor: "pointer",
  display: "flex",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

// Pinned to the foot of the control, under the track and out of its way.
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

// Quick to rise and quick to fall: the levels arrive twenty times a second,
// and a slower ease would draw a level that had already gone.
const meterFillStyles = css({
  backgroundColor: "color-mix(in oklab, currentcolor 70%, transparent)",
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

// Eased into place when it jumps — a click on the track, a key, the desk
// answering — and pinned to the pointer while it is dragged, where any easing
// is lag.
const indicatorStyles = css({
  "&:not([data-dragging])": {
    transition: "inline-size {durations.normal} {easings.outQuart}",
  },
  backgroundColor: "currentcolor",
  blockSize: "100%",
  borderRadius: "full",
});

// Placed by base-ui's own inline `translate` and `top`, so the press is `scale`
// rather than a `transform` that would fight them.
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
