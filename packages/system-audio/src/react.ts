// Sound for a React shell: one sound server watch per desktop, however many
// parts read it.

import type { Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { useDeskWatch } from "@domicile-desktop/react/use-shared-watch";
import { watchPresence } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { Audio } from "./audio";
import { hasSoundCard } from "./hardware";
import { sharedMeters } from "./shared-meters";
import type { SoundServer } from "./sound-server";
import { soundServer } from "./sound-server";

/** The sound server's requests. Its state is {@link DeskSound.audio}. */
export type SoundControls = Omit<SoundServer, "watch">;

export type DeskSound = {
  audio: SharedWatch<Audio>;
  /** Its meters are shared by id among open mixers. */
  sound: SoundControls;
};

/** The sound server, watched once per desktop. */
export const deskSound = perDesktop((domicile): DeskSound => {
  const { watch, ...sound } = soundServer(domicile);
  return {
    audio: sharedWatch(watch),
    sound: { ...sound, meters: sharedMeters(sound.meters) },
  };
});

/** Whether the machine has a sound card, looked for once per desktop. */
export const deskSoundHardware = perDesktop(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(() => hasSoundCard(domicile), onPresent),
    ),
);

/** The sound server's devices and streams, or `undefined` before it says. */
export const useAudio = (): Audio | undefined =>
  useDeskWatch((domicile) => deskSound(domicile).audio);

/** Whether the machine has a sound card, or `undefined` before it was looked for. */
export const useHasSoundCard = (): Result<boolean, SystemError> | undefined =>
  useDeskWatch(deskSoundHardware);
