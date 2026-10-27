import type { AudioDevice } from "@domicile-desktop/system-audio/audio";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerLowIcon } from "@phosphor-icons/react/dist/ssr/SpeakerLow";
import { SpeakerNoneIcon } from "@phosphor-icons/react/dist/ssr/SpeakerNone";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";

/**
 * A speaker icon whose waves show the default output's rough volume, slashed
 * while muted or with no output.
 */
export const Speaker = ({ output }: { output: AudioDevice | undefined }) => {
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

/** Names the {@link Speaker}. */
export const speakerLabel = (output: AudioDevice | undefined) => {
  if (output === undefined) {
    return "Sound";
  } else if (output.muted) {
    return "Volume muted";
  } else {
    return `Volume ${Math.round(output.volume * 100)}%`;
  }
};
