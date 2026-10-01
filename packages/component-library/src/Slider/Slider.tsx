import { Slider as BaseSlider } from "@base-ui/react/slider";

import { css } from "../../styled-system/css";

type Props = Omit<
  BaseSlider.Root.Props<number>,
  "children" | "className" | "style"
> & {
  /** What the slider sets, for a screen reader: the thumb's name. */
  label: string;
};

/**
 * One value picked off a range: a fat pill whose fill runs from its start to
 * a knob riding inside it, the shape a phone's control center uses for a
 * brightness or a volume.
 *
 * Single-valued: a range of two thumbs is a different control and nothing here
 * asks for one. Every interaction — pointer, keyboard, the hidden range input a
 * screen reader drives — is base-ui's.
 */
export const Slider = ({ label, ...rootProps }: Props) => (
  <BaseSlider.Root className={rootStyles} {...rootProps}>
    <BaseSlider.Control className={controlStyles}>
      <BaseSlider.Track className={trackStyles}>
        <BaseSlider.Indicator className={indicatorStyles} />
        <BaseSlider.Thumb aria-label={label} className={thumbStyles} />
      </BaseSlider.Track>
    </BaseSlider.Control>
  </BaseSlider.Root>
);

// As wide as whatever holds it, and a flex item that takes what is left of a
// row rather than shrinking to its own empty content.
const rootStyles = css({
  flexGrow: 1,
  inlineSize: "100%",
});

// THE PILL. Padded by half a knob at each end, so the knob's center can reach
// the track's ends and the knob itself never leaves the pill — the track is
// the padded box's inside, and a value is a position along it.
const controlStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 18%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "color-mix(in oklab, {colors.foreground} 12%, transparent)",
  blockSize: 9,
  borderRadius: "full",
  boxShadow:
    "inset 0 {spacing.0.5} {spacing.1} color-mix(in oklab, {colors.background} 55%, transparent)",
  cursor: "pointer",
  display: "flex",
  inlineSize: "100%",
  paddingInline: 4.5,
  touchAction: "none",
  transition: "background-color {durations.fast} {easings.default}",
  userSelect: "none",
});

const trackStyles = css({
  blockSize: "100%",
  inlineSize: "100%",
  position: "relative",
});

// THE FILL, from the track's start to the knob's center — and then, through
// the two caps, from the pill's own start to the knob's far edge, which is
// what makes the fill and the knob read as one lit shape rather than a bar
// with a dot on it. Each cap is half a knob wide, the padding above, in the
// color the gradient has at that end. The ramp climbs from a wash of the accent
// to the accent itself, so the fill brightens toward the bright end in either
// theme.
const indicatorStyles = css({
  "&::after": {
    backgroundColor: "accent",
    borderEndEndRadius: "full",
    borderStartEndRadius: "full",
    content: '""',
    inlineSize: 4.5,
    insetBlock: 0,
    insetInlineStart: "100%",
    position: "absolute",
  },
  "&::before": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 50%, {colors.card})",
    borderEndStartRadius: "full",
    borderStartStartRadius: "full",
    content: '""',
    inlineSize: 4.5,
    insetBlock: 0,
    insetInlineEnd: "100%",
    position: "absolute",
  },
  // Eased into place when it jumps — a click on the pill, a key, the desk
  // answering — and pinned to the pointer while it is dragged, where any
  // easing is lag.
  "&:not([data-dragging])": {
    transition:
      "inline-size {durations.normal} {easings.outQuart}, inset-inline-start {durations.normal} {easings.outQuart}",
  },
  backgroundImage:
    "linear-gradient(to right, color-mix(in oklab, {colors.accent} 50%, {colors.card}), {colors.accent})",
  blockSize: "100%",
  boxShadow:
    "0 0 {spacing.5} color-mix(in oklab, {colors.accent} 45%, transparent)",
});

// THE KNOB. Light in both themes — a dark knob on a lit fill reads as a hole —
// which is `foreground` in the dark one and `background` in the light one.
// Placed by base-ui's own inline `translate` and `top`, so the press is `scale`
// rather than a `transform` that would fight them.
const thumbStyles = css({
  "&:has(:focus-visible)": {
    boxShadow:
      "0 0 0 {spacing.1} color-mix(in oklab, {colors.accent} 50%, transparent), {shadows.lifted}",
  },
  "&:not([data-dragging])": {
    transition:
      "inset-inline-start {durations.normal} {easings.outQuart}, scale {durations.normal} {easings.outBack}, box-shadow {durations.fast} {easings.default}",
  },
  "&[data-dragging]": {
    scale: "0.9",
    transition:
      "scale {durations.fast} {easings.out}, box-shadow {durations.fast} {easings.default}",
  },
  backgroundColor: { _light: "background", base: "foreground" },
  blockSize: 7,
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  inlineSize: 7,
  outlineStyle: "none",
});
