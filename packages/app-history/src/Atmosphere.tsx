import { css } from "../styled-system/css";

/** Slow glows of the accent behind the page, under a faint dot grid. */
export const Atmosphere = () => (
  <div aria-hidden className={rootStyles}>
    <span className={glowStyles} data-glow="accent" />
    <span className={glowStyles} data-glow="private" />
    <span className={gridStyles} />
  </div>
);

const rootStyles = css({
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
  position: "fixed",
  zIndex: 0,
});

// Percentages, so the glow fills a window of any size the same way.
const glowStyles = css({
  _light: { opacity: 0.55 },
  "&[data-glow=accent]": {
    backgroundImage:
      "radial-gradient(circle, color-mix(in oklab, {colors.accent} 38%, transparent), transparent 62%)",
    inlineSize: "70%",
    insetBlockStart: "-45%",
    insetInlineStart: "-15%",
  },
  "&[data-glow=private]": {
    animationDirection: "alternate-reverse",
    animationDuration: "calc({durations.drift} * 1.4)",
    backgroundImage:
      "radial-gradient(circle, color-mix(in oklab, {colors.private} 30%, transparent), transparent 62%)",
    inlineSize: "60%",
    insetBlockStart: "-40%",
    insetInlineEnd: "-15%",
  },
  animation: "glowDrift {durations.drift} {easings.in-out} infinite alternate",
  aspectRatio: "1",
  filter: "blur({spacing.10})",
  position: "absolute",
});

const gridStyles = css({
  backgroundImage:
    "radial-gradient(color-mix(in oklab, {colors.foreground} 14%, transparent) 1px, transparent 1px)",
  backgroundSize: "{spacing.6} {spacing.6}",
  inset: 0,
  maskImage: "linear-gradient(to bottom, {colors.foreground}, transparent 45%)",
  position: "absolute",
});
