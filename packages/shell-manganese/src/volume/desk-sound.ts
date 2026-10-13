import { system } from "@domicile-desktop/sdk/system";
import type { Audio } from "@domicile-desktop/system-audio/audio";
import type { SoundServer } from "@domicile-desktop/system-audio/sound-server";
import { soundServer } from "@domicile-desktop/system-audio/sound-server";

import { perHost } from "../host/per-host";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";
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
