// The volume, microphone and brightness keys, as the `volume`, `mic` and
// `brightness` commands name them. They act through the same watches as the
// bar's volume and brightness items.

import type { BrightnessKeys } from "@domicile-desktop/manganese-bar-module-brightness/useBrightnessKeys";
import type { VolumeKeys } from "@domicile-desktop/manganese-bar-module-volume/useVolumeKeys";
import { MediaKey } from "@domicile-desktop/manganese-window-management/keyboard/media-key";

/** What each media key does. */
export type MediaKeys = { brightness: BrightnessKeys; volume: VolumeKeys };

/** Run what `key` does. */
export const pressMediaKey = (
  { brightness, volume }: MediaKeys,
  key: MediaKey,
): void => {
  switch (key) {
    case MediaKey.VolumeUp: {
      volume.up();
      break;
    }
    case MediaKey.VolumeDown: {
      volume.down();
      break;
    }
    case MediaKey.VolumeMute: {
      volume.mute();
      break;
    }
    case MediaKey.MicMute: {
      volume.micMute();
      break;
    }
    case MediaKey.BrightnessUp: {
      brightness.up();
      break;
    }
    case MediaKey.BrightnessDown: {
      brightness.down();
      break;
    }
  }
};
