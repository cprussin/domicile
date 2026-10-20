// The volume, microphone and brightness keys, as the `volume`, `mic` and
// `brightness` commands name them. They act through the same watches as the
// bar's volume and brightness items.

import type { BrightnessKeys } from "@domicile-desktop/manganese-bar-module-brightness/useBrightnessKeys";
import type {
  AskedLevel,
  VolumeKeys,
} from "@domicile-desktop/manganese-bar-module-volume/useVolumeKeys";
import { MediaKey } from "@domicile-desktop/manganese-window-management/keyboard/media-key";

/** What each media key does. */
export type MediaKeys = { brightness: BrightnessKeys; volume: VolumeKeys };

/** Which level a media key changed. */
export enum LevelKind {
  Volume,
  Microphone,
  Brightness,
}

/** The level a media key asked for, to show the user. */
export type KeyLevel = AskedLevel & { kind: LevelKind };

/**
 * Run what `key` does. Returns the level it asked for, or `undefined` when
 * the key did nothing.
 */
export const pressMediaKey = (
  { brightness, volume }: MediaKeys,
  key: MediaKey,
): KeyLevel | undefined => {
  switch (key) {
    case MediaKey.VolumeUp: {
      return ofKind(LevelKind.Volume, volume.up());
    }
    case MediaKey.VolumeDown: {
      return ofKind(LevelKind.Volume, volume.down());
    }
    case MediaKey.VolumeMute: {
      return ofKind(LevelKind.Volume, volume.mute());
    }
    case MediaKey.MicMute: {
      return ofKind(LevelKind.Microphone, volume.micMute());
    }
    case MediaKey.BrightnessUp: {
      return brightnessLevel(brightness.up());
    }
    case MediaKey.BrightnessDown: {
      return brightnessLevel(brightness.down());
    }
  }
};

const ofKind = (
  kind: LevelKind,
  asked: AskedLevel | undefined,
): KeyLevel | undefined =>
  asked === undefined ? undefined : { ...asked, kind };

const brightnessLevel = (level: number | undefined): KeyLevel | undefined =>
  level === undefined
    ? undefined
    : { kind: LevelKind.Brightness, level, muted: false };
