import type { AudioDevice } from "@domicile/chrome-sdk/audio";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { AudioMessage } from "@domicile/chrome-sdk/host-message";
import { Popover } from "@domicile/component-library/Popover";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleHigh";
import { SpeakerSimpleLowIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleLow";
import { SpeakerSimpleNoneIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleNone";
import { SpeakerSimpleSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleSlash";
import { SpeakerSimpleXIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleX";
import type { WheelEvent } from "react";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { grid } from "../../styled-system/patterns";
import { Level } from "./Level";
import { Mixer } from "./Mixer";
import { watchAudio } from "./watch-audio";

/** How far one notch of the wheel over the icon moves the volume. */
const WHEEL_STEP = 0.05;

type Props = {
  /** Where the sound comes from and where a change is asked for. */
  domicile: DomicileClient;
  /** The monitor this bar is on, which the whole mixer opens over. */
  screen: string;
  /** How it is watched; injected so tests can drive a sound server. */
  watch?: typeof watchAudio | undefined;
};

/**
 * The desk's sound, on the bar: a speaker drawn as loud as the default output
 * is, which opens a panel of two sliders — that output and the default
 * microphone — and which the wheel turns without opening anything.
 *
 * **Everything else is one press further**: the panel's mixer button opens
 * the whole of it — every output and input, every stream playing and
 * recording, every card's profile — which is what pavucontrol was for. See
 * {@link Mixer}.
 *
 * Nothing is drawn until the host has said the sound, which on a desk with no
 * sound server is never.
 */
export const Volume = ({ domicile, screen, watch = watchAudio }: Props) => {
  const [audio, setAudio] = useState<AudioMessage | undefined>(undefined);
  const [mixing, setMixing] = useState(false);
  const [panel, setPanel] = useState(false);

  useEffect(() => watch(domicile, setAudio), [domicile, watch]);

  if (audio === undefined) {
    return undefined;
  } else {
    const output = audio.outputs.find((device) => device.default);
    const input = audio.inputs.find(
      (device) => device.default && !device.monitor,
    );
    return (
      <>
        <Popover
          align="center"
          onOpenChange={setPanel}
          open={panel}
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
          <span className={panelStyles}>
            {output !== undefined && (
              <Level
                direction="output"
                label="Volume"
                level={output.volume}
                muted={output.muted}
                onLevel={(level) => {
                  domicile.setAudioVolume(output.id, level);
                }}
                onMuted={(muted) => {
                  domicile.setAudioMuted(output.id, muted);
                }}
              />
            )}
            {input !== undefined && (
              <Level
                direction="input"
                label="Microphone"
                level={input.volume}
                muted={input.muted}
                onLevel={(level) => {
                  domicile.setAudioVolume(input.id, level);
                }}
                onMuted={(muted) => {
                  domicile.setAudioMuted(input.id, muted);
                }}
              />
            )}
            <button
              aria-label="All devices"
              className={mixerStyles}
              onClick={() => {
                setPanel(false);
                setMixing(true);
              }}
              type="button"
            >
              <SlidersHorizontalIcon size={15} />
            </button>
          </span>
        </Popover>
        <Mixer
          audio={audio}
          domicile={domicile}
          onOpenChange={setMixing}
          open={mixing}
          screen={screen}
        />
      </>
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

// The sliders stacked, and the mixer's button beside them both.
const panelStyles = grid({
  "& > button:last-child": {
    gridColumn: 2,
    gridRow: "1 / span 2",
  },
  alignItems: "center",
  columnGap: 2,
  gridTemplateColumns: "1fr auto",
  inlineSize: 64,
  rowGap: 1,
});

const mixerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
});
