import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import {
  MOON_BOLD,
  MOON_FILL,
  SUN_BOLD,
  SUN_FILL,
} from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";

const PARTS = {
  bold: { moon: MOON_BOLD.moon, sun: SUN_BOLD },
  fill: { moon: MOON_FILL.moon, sun: SUN_FILL },
};

type Props = {
  /** The moon while dark, the sun while light. */
  dark: boolean;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
  weight: keyof typeof PARTS;
};

/**
 * Phosphor's `Sun` and `Moon` in one. Going dark, the sun's rays fold in
 * clockwise and the moon turns into place; going light, the moon turns away
 * and the rays come back out in turn. Pointed at, the moon rocks or the rays
 * pulse.
 *
 * The change is keyframes, not transitions: it plays during the theme wipe,
 * which turns transitions off. So it plays only once `dark` has changed,
 * never on mount.
 */
export const AnimatedThemeIcon = ({ dark, label, size, weight }: Props) => {
  const { moon, sun } = PARTS[weight];
  const changed = useCue(dark) > 0;
  const sunState = dark ? "hidden" : "shown";
  return (
    <IconFrame label={label} size={size}>
      <IconPart
        d={sun.core}
        name="core"
        state={sunState}
        stateStyles={changed ? coreChangeStyles : coreStyles}
      />
      {sun.rays.map((d, index) => (
        <IconPart
          d={d}
          hoverStyles={dark ? undefined : rayPulseStyles}
          key={d}
          name="ray"
          order={index}
          state={sunState}
          stateStyles={changed ? rayChangeStyles : rayStyles}
        />
      ))}
      <IconPart
        d={moon}
        hoverStyles={dark ? moonRockStyles : undefined}
        name="moon"
        state={dark ? "shown" : "hidden"}
        stateStyles={changed ? moonChangeStyles : moonStyles}
      />
    </IconFrame>
  );
};

// Each part at rest in its state, and the same with the change playing into
// it. Reduced motion drops the animation, which leaves the rest.

const coreStyles = css({
  "&[data-state=hidden]": { opacity: 0 },
});

const coreChangeStyles = css({
  "&[data-state=hidden]": {
    animation: "iconCoreOut {durations.normal} {easings.in} both",
    opacity: 0,
  },
  "&[data-state=shown]": {
    animation:
      "iconCoreIn {durations.slower} {easings.outBack} {durations.faster} both",
  },
});

const rayStyles = css({
  "&[data-state=hidden]": { opacity: 0 },
});

const rayChangeStyles = css({
  "&[data-state=hidden]": {
    animation:
      "iconRayOut {durations.normal} {easings.in} calc(var(--part-order) * {durations.fastest} / 2) both",
    opacity: 0,
  },
  "&[data-state=shown]": {
    animation:
      "iconRayIn {durations.slow} {easings.outBack} calc({durations.fast} + var(--part-order) * {durations.fastest} * 0.6) both",
  },
});

const moonStyles = css({
  "&[data-state=hidden]": { opacity: 0 },
});

const moonChangeStyles = css({
  "&[data-state=hidden]": {
    animation: "iconMoonOut {durations.normal} {easings.in} both",
    opacity: 0,
  },
  "&[data-state=shown]": {
    animation:
      "iconMoonIn {durations.slowest} {easings.outBack} {durations.fast} both",
  },
});

const moonRockStyles = css({
  _controlHover: {
    animation: "iconMoonRock {durations.slowest} {easings.in-out}",
  },
});

const rayPulseStyles = css({
  _controlHover: {
    animation:
      "iconRayPulse {durations.slow} {easings.in-out} calc(var(--part-order) * {durations.fastest} * 0.6) both",
  },
});
