import { Popover } from "@domicile-desktop/component-library/Popover";
import type { AudioDevice } from "@domicile-desktop/sdk/audio";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleHigh";
import { SpeakerSimpleLowIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleLow";
import { SpeakerSimpleNoneIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleNone";
import { SpeakerSimpleSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleSlash";
import { SpeakerSimpleXIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleX";
import type { WheelEvent } from "react";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { Mixer } from "./Mixer";
import type { Audio } from "./watch-audio";
import { watchAudio } from "./watch-audio";
import type { watchAudioLevels } from "./watch-audio-levels";

/** How far one notch of the wheel over the icon moves the volume. */
const WHEEL_STEP = 0.05;

type Props = {
  /** Source of audio state and target of volume changes. */
  domicile: DomicileHost;
  /** Injected so tests can drive the audio state. */
  watch?: typeof watchAudio | undefined;
  /** Injected so tests can drive the meters. */
  watchLevels?: typeof watchAudioLevels | undefined;
};

/**
 * Top bar volume item: a speaker icon that opens the {@link Mixer}. The wheel
 * over the icon changes the default output's volume.
 *
 * Renders nothing until the host reports audio, so it stays hidden without a
 * sound server. The mixer meters only while open, because metering a
 * microphone records it.
 */
export const Volume = ({
  domicile,
  watch = watchAudio,
  watchLevels,
}: Props) => {
  const [audio, setAudio] = useState<Audio | undefined>(undefined);

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
        wide
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

/** A speaker icon whose waves show the default output's rough volume. */
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

/** The output's volume after one wheel notch, rounded and clamped to 0–1. */
const stepped = (output: AudioDevice, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(
    1,
    Math.max(0, Math.round((output.volume + step) * 100) / 100),
  );
};

// Matches the brightness item's button.
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
