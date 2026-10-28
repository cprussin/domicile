import type { Result } from "@cprussin/option-result";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import { isAbsent } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Audio } from "@domicile-desktop/system-audio/audio";
import type { SoundControls } from "@domicile-desktop/system-audio/react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import type { MouseEvent, WheelEvent } from "react";

import { cva } from "../styled-system/css";
import { ask } from "./ask";
import { Level } from "./Level";
import { primary } from "./primary";
import { Speaker, speakerLabel } from "./Speaker";
import { stepped } from "./stepped";

type Watches = {
  /** The sound server's state. */
  audio: SharedWatch<Audio>;
  /** Whether the machine has a sound card, from `/sys`. */
  hardware: SharedWatch<Result<boolean, SystemError>>;
};

/**
 * The speaker in the quick settings button, dimmed while muted. Dimmed and
 * slashed with a sound card and no sound server; nothing without a card.
 */
export const SoundGlyph = ({ audio: watch, hardware }: Watches) => {
  const audio = useSharedWatch(watch);
  const present = useSharedWatch(hardware);
  if (audio === undefined) {
    return isAbsent(present) ? undefined : (
      <span
        aria-label="Sound unavailable"
        className={glyphStyles({ dim: true })}
        role="img"
      >
        <SpeakerSlashIcon size={15} weight="bold" />
      </span>
    );
  } else {
    const output = audio.outputs.find((device) => device.default);
    return (
      <span
        aria-label={speakerLabel(output)}
        className={glyphStyles({ dim: output?.muted === true })}
        role="img"
      >
        <Speaker output={output} />
      </span>
    );
  }
};

/**
 * The volume item's gestures, for a button that holds the {@link SoundGlyph}:
 * the wheel turns the default output, and a middle click mutes it.
 */
export const useSoundGestures = (
  watch: SharedWatch<Audio>,
  server: SoundControls,
) => {
  const output = useSharedWatch(watch)?.outputs.find(
    (device) => device.default,
  );
  return {
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1 && output !== undefined) {
        ask(server.setMuted(output.id, !output.muted));
      }
    },
    onWheel: (event: WheelEvent) => {
      if (output !== undefined) {
        ask(server.setVolume(output.id, stepped(output, event)));
      }
    },
  };
};

type RowProps = {
  audio: SharedWatch<Audio>;
  server: SoundControls;
  /** Opens the mixer; without it, as on a locked desktop, there is no arrow. */
  onMore?: (() => void) | undefined;
};

/** The quick settings volume slider for the default output, with an arrow to the mixer. */
export const SoundRow = ({ audio: watch, onMore, server }: RowProps) => {
  const output = primary(useSharedWatch(watch)?.outputs ?? []);
  return output === undefined ? undefined : (
    <Level
      direction="output"
      end={
        onMore !== undefined && (
          <IconButton label="Sound details" onClick={onMore}>
            <CaretRightIcon aria-hidden size={14} weight="bold" />
          </IconButton>
        )
      }
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
  );
};

const glyphStyles = cva({
  base: { display: "inline-flex", flexShrink: 0 },
  variants: {
    dim: {
      false: {},
      true: { opacity: "inactive" },
    },
  },
});
