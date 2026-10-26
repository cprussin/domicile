import type { Result } from "@cprussin/option-result";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import { isAbsent } from "@domicile-desktop/manganese-host/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Audio, AudioDevice } from "@domicile-desktop/system-audio/audio";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerLowIcon } from "@phosphor-icons/react/dist/ssr/SpeakerLow";
import { SpeakerNoneIcon } from "@phosphor-icons/react/dist/ssr/SpeakerNone";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import type { WheelEvent } from "react";
import { css, cva } from "../styled-system/css";
import { ask } from "./ask";
import type { SoundControls } from "./desk-sound";
import { Level } from "./Level";
import { Mixer } from "./Mixer";
import { primary } from "./primary";

/** How far one notch of the wheel over the icon moves the volume. */
const WHEEL_STEP = 0.05;

type Props = {
  /** The sound server's state. */
  audio: SharedWatch<Audio>;
  /** Whether the machine has a sound card, from `/sys`. */
  hardware: SharedWatch<Result<boolean, SystemError>>;
  /** Whether the desktop is locked; see below. */
  locked?: boolean | undefined;
  /** The target of volume changes. */
  server: SoundControls;
};

/**
 * Top bar volume item: a speaker icon that opens the {@link Mixer}. The wheel
 * over the icon changes the default output's volume; a middle click mutes or
 * unmutes it.
 *
 * Dims while the default output is muted. Until a sound server reports, it is
 * a dimmed icon alone on a machine with a sound card, and nothing on one
 * without. The mixer meters only while open, because metering a microphone
 * records it.
 *
 * On a locked desktop the panel holds only the default output's volume and
 * mute, the requests a locked desktop allows.
 */
export const Volume = ({
  audio: watch,
  hardware,
  locked = false,
  server,
}: Props) => {
  const audio = useSharedWatch(watch);
  const present = useSharedWatch(hardware);

  if (audio === undefined) {
    return isAbsent(present) ? undefined : (
      <Tooltip
        content="Sound unavailable"
        tone="overPhoto"
        trigger={
          <span
            aria-label="Sound unavailable"
            className={unavailableStyles}
            role="img"
          >
            <SpeakerSlashIcon size={15} weight="bold" />
          </span>
        }
      />
    );
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
            className={triggerStyles({ muted: output?.muted === true })}
            onAuxClick={(event) => {
              if (event.button === 1 && output !== undefined) {
                ask(server.setMuted(output.id, !output.muted));
              }
            }}
            onWheel={(event) => {
              if (output !== undefined) {
                ask(server.setVolume(output.id, stepped(output, event)));
              }
            }}
            type="button"
          >
            <Speaker output={output} />
          </button>
        }
        wide={!locked}
      >
        {locked ? (
          <OutputLevel audio={audio} server={server} />
        ) : (
          <Mixer audio={audio} server={server} />
        )}
      </Popover>
    );
  }
};

/** The default output's volume and mute, unmetered. */
const OutputLevel = ({
  audio,
  server,
}: {
  audio: Audio;
  server: SoundControls;
}) => {
  const output = primary(audio.outputs);
  return output === undefined ? undefined : (
    <span className={outputLevelStyles}>
      <Level
        direction="output"
        label="Volume"
        level={output.volume}
        muted={output.muted}
        onLevel={(level) => {
          ask(server.setVolume(output.id, level));
        }}
        onMuted={(muted) => {
          ask(server.setMuted(output.id, muted));
        }}
      />
    </span>
  );
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
 * A speaker icon whose waves show the default output's rough volume, slashed
 * while muted or with no output.
 */
const Speaker = ({ output }: { output: AudioDevice | undefined }) => {
  if (output === undefined || output.muted) {
    return <SpeakerSlashIcon size={15} weight="bold" />;
  } else if (output.volume === 0) {
    return <SpeakerNoneIcon size={15} weight="bold" />;
  } else if (output.volume < 0.5) {
    return <SpeakerLowIcon size={15} weight="bold" />;
  } else {
    return <SpeakerHighIcon size={15} weight="bold" />;
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
const triggerStyles = cva({
  base: {
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
  },
  variants: {
    muted: {
      false: {},
      // Dims the icon alone, so the hover background stays as strong.
      true: { "& > svg": { opacity: "inactive" } },
    },
  },
});

// The button's box, so the bar's spacing stays the same.
const unavailableStyles = css({
  alignItems: "center",
  blockSize: 7,
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  opacity: "inactive",
});

// As wide as the brightness item's slider.
const outputLevelStyles = css({
  display: "block",
  inlineSize: 60,
});
