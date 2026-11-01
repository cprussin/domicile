import { useState } from "react";

import { css } from "../../styled-system/css";
import type { Weight } from "../_icon/IconFrame";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import {
  SPEAKER_BOLD,
  SPEAKER_FILL,
  SPEAKER_REGULAR,
} from "../_icon/phosphor-parts";
import "../stylesheet";

const PARTS = {
  bold: SPEAKER_BOLD,
  fill: SPEAKER_FILL,
  regular: SPEAKER_REGULAR,
} satisfies Record<Weight, unknown>;

/** The volume at and above which the second wave shows, as in `SpeakerHigh`. */
const LOUD = 0.5;

/** Where the waves leave the cone. */
const MOUTH = [168, 128] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  muted: boolean;
  size: number;
  /** 0 through 1. */
  volume: number;
  weight: Weight;
};

/**
 * Phosphor's `SpeakerHigh`, `SpeakerLow`, `SpeakerNone` and `SpeakerSlash` in
 * one. A wave shows for each step of volume; the waves push out when it goes
 * up and pull in when it goes down, and push out while the control the icon
 * is in is pointed at. Muting tucks them away and draws the slash.
 */
export const AnimatedSpeakerIcon = ({
  label,
  muted,
  size,
  volume,
  weight,
}: Props) => {
  const pulse = usePulse(volume);
  const parts = PARTS[weight];
  return (
    <IconFrame label={label} size={size} slash={{ shown: muted, weight }}>
      <IconPart d={parts.cone} name="cone" />
      {parts.waves.map((d, index) => (
        <IconPart
          cue={pulse.count}
          cueStyles={pulse.louder ? wavePushStyles : wavePullStyles}
          d={d}
          hoverStyles={muted ? undefined : waveHoverStyles}
          key={d}
          name="wave"
          order={index}
          origin={MOUTH}
          state={waveState(index, volume, muted)}
          stateStyles={waveStyles}
        />
      ))}
    </IconFrame>
  );
};

const waveStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translateX(-14px) scaleY(0.7)",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out}, transform {durations.slow} {easings.outBack}",
  },
});

const wavePushStyles = css({
  "&[data-cued]": {
    animation:
      "iconWavePush {durations.slower} {easings.in-out} calc(var(--part-order) * {durations.faster}) both",
  },
});

const wavePullStyles = css({
  "&[data-cued]": {
    animation:
      "iconWavePull {durations.slower} {easings.in-out} calc(var(--part-order) * {durations.faster}) both",
  },
});

const waveHoverStyles = css({
  _controlHover: {
    animation:
      "iconWavePush {durations.slower} {easings.in-out} calc(var(--part-order) * {durations.faster}) both",
  },
});

/** How many times `volume` has changed since mount, and whether it last went up. */
const usePulse = (volume: number) => {
  const [last, setLast] = useState(volume);
  const [pulse, setPulse] = useState({ count: 0, louder: true });
  if (volume !== last) {
    setLast(volume);
    setPulse({ count: pulse.count + 1, louder: volume > last });
  }
  return pulse;
};

/** The first wave shows above silence, the second from `LOUD`; neither while muted. */
const waveState = (index: number, volume: number, muted: boolean) => {
  const heard = index === 0 ? volume > 0 : volume >= LOUD;
  return !muted && heard ? "shown" : "hidden";
};
