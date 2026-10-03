import { Popover } from "@domicile-desktop/component-library/Popover";
import type { AudioDevice } from "@domicile-desktop/sdk/audio";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { AudioMessage } from "@domicile-desktop/sdk/host-message";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleHigh";
import { SpeakerSimpleLowIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleLow";
import { SpeakerSimpleNoneIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleNone";
import { SpeakerSimpleSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleSlash";
import { SpeakerSimpleXIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleX";
import type { WheelEvent } from "react";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { Mixer } from "./Mixer";
import { watchAudio } from "./watch-audio";
import type { watchAudioLevels } from "./watch-audio-levels";

/** How far one notch of the wheel over the icon moves the volume. */
const WHEEL_STEP = 0.05;

type Props = {
  /** Where the sound comes from and where a change is asked for. */
  domicile: DomicileClient;
  /** How it is watched; injected so tests can drive a sound server. */
  watch?: typeof watchAudio | undefined;
  /** How the meters are watched, likewise. */
  watchLevels?: typeof watchAudioLevels | undefined;
};

/**
 * The desk's sound, on the bar: a speaker drawn as loud as the default output
 * is, which opens the whole mixer in a panel hung off the bar — and which the
 * wheel turns without opening anything.
 *
 * The panel is {@link Mixer}: the default output and microphone first, with
 * their meters, and everything else a section below them. It is metered only
 * while it is open — the meters stop when it shuts, because metering a
 * microphone records it.
 *
 * Nothing is drawn until the host has said the sound, which on a desk with no
 * sound server is never.
 */
export const Volume = ({
  domicile,
  watch = watchAudio,
  watchLevels,
}: Props) => {
  const [audio, setAudio] = useState<AudioMessage | undefined>(undefined);

  useEffect(() => watch(domicile, setAudio), [domicile, watch]);

  if (audio === undefined) {
    return undefined;
  } else {
    const output = audio.outputs.find((device) => device.default);
    return (
      <Popover
        align="center"
        side="bottom"
        tone="overPhoto"
        trigger={
          <button
            aria-label={triggerLabel(output)}
            className={triggerStyles}
            onWheel={(event) => {
              if (output !== undefined) {
                domicile.setAudioVolume(output.id, stepped(output, event));
              }
            }}
            type="button"
          >
            <Speaker output={output} />
          </button>
        }
      >
        <Mixer audio={audio} domicile={domicile} watchLevels={watchLevels} />
      </Popover>
    );
  }
};

const triggerLabel = (output: AudioDevice | undefined) => {
  if (output === undefined) {
    return "Sound";
  } else if (output.muted) {
    return "Volume muted";
  } else {
    return `Volume ${Math.round(output.volume * 100)}%`;
  }
};

/**
 * A speaker whose waves follow the default output — none, one, two, or a
 * cross when it is muted — so the bar says roughly how loud the desk is
 * without a figure.
 */
const Speaker = ({ output }: { output: AudioDevice | undefined }) => {
  if (output === undefined) {
    return <SpeakerSimpleSlashIcon size={15} weight="bold" />;
  } else if (output.muted) {
    return <SpeakerSimpleXIcon size={15} weight="bold" />;
  } else if (output.volume === 0) {
    return <SpeakerSimpleNoneIcon size={15} weight="bold" />;
  } else if (output.volume < 0.5) {
    return <SpeakerSimpleLowIcon size={15} weight="bold" />;
  } else {
    return <SpeakerSimpleHighIcon size={15} weight="bold" />;
  }
};

/**
 * A notch of the wheel from where the output is, rounded to the percent and
 * kept between silence and 100%.
 */
const stepped = (output: AudioDevice, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(
    1,
    Math.max(0, Math.round((output.volume + step) * 100) / 100),
  );
};

// The bar's button, as the brightness's is and for its reason.
const triggerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});
