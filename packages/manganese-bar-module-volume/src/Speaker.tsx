import { AnimatedSpeakerIcon } from "@domicile-desktop/component-library/AnimatedSpeakerIcon";
import type { AudioDevice } from "@domicile-desktop/system-audio/audio";

/**
 * A speaker icon whose waves show the default output's rough volume, and
 * pulse as it changes, slashed while muted or with no output.
 */
export const Speaker = ({ output }: { output: AudioDevice | undefined }) => (
  <AnimatedSpeakerIcon
    muted={output === undefined || output.muted}
    size={15}
    volume={output?.volume ?? 0}
    weight="bold"
  />
);

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
