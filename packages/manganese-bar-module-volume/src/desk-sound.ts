import type { Result } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { watchPresence } from "@domicile-desktop/manganese-host/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Audio } from "@domicile-desktop/system-audio/audio";
import { hasSoundCard } from "@domicile-desktop/system-audio/hardware";
import type { SoundServer } from "@domicile-desktop/system-audio/sound-server";
import { soundServer } from "@domicile-desktop/system-audio/sound-server";
import { sharedMeters } from "./shared-meters";

/** The sound server's requests. Its state is {@link DeskSound.audio}. */
export type SoundControls = Omit<SoundServer, "watch">;

export type DeskSound = {
  audio: SharedWatch<Audio>;
  /** Its meters are shared by id among open mixers. */
  sound: SoundControls;
};

/** The sound server, watched once for every bar and the lock screen. */
export const deskSound = perHost((domicile): DeskSound => {
  const { watch, ...sound } = soundServer(system(domicile));
  return {
    audio: sharedWatch(watch),
    sound: { ...sound, meters: sharedMeters(sound.meters) },
  };
});

/** Whether the machine has a sound card, looked for once for every bar and the lock screen. */
export const deskSoundHardware = perHost(
  (domicile): SharedWatch<Result<boolean, SystemError>> =>
    sharedWatch((onPresent) =>
      watchPresence(() => hasSoundCard(system(domicile)), onPresent),
    ),
);
