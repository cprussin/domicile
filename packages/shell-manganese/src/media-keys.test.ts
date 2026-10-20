import { describe, expect, it } from "bun:test";
import { MediaKey } from "@domicile-desktop/manganese-window-management/keyboard/media-key";

import { LevelKind, pressMediaKey } from "./media-keys";

/**
 * Keys that record which of them was pressed. Each answers 40%, muted for the
 * sound keys, or nothing when `acting` is false.
 */
const recording = (acting = true) => {
  const answer = acting ? 0.4 : undefined;
  const pressed: string[] = [];
  const press = (name: string) => () => {
    pressed.push(name);
    return answer;
  };
  const pressVolume = (name: string) => () => {
    pressed.push(name);
    return answer === undefined ? undefined : { level: answer, muted: true };
  };
  return {
    keys: {
      brightness: {
        down: press("brightness down"),
        up: press("brightness up"),
      },
      volume: {
        down: pressVolume("volume down"),
        micMute: pressVolume("mic mute"),
        mute: pressVolume("volume mute"),
        up: pressVolume("volume up"),
      },
    },
    pressed,
  };
};

describe("pressMediaKey", () => {
  it.each([
    [MediaKey.VolumeUp, "volume up", LevelKind.Volume, true],
    [MediaKey.VolumeDown, "volume down", LevelKind.Volume, true],
    [MediaKey.VolumeMute, "volume mute", LevelKind.Volume, true],
    [MediaKey.MicMute, "mic mute", LevelKind.Microphone, true],
    [MediaKey.BrightnessUp, "brightness up", LevelKind.Brightness, false],
    [MediaKey.BrightnessDown, "brightness down", LevelKind.Brightness, false],
  ])("presses key %d as %s and shows its level", (key, name, kind, muted) => {
    const { keys, pressed } = recording();

    const shown = pressMediaKey(keys, key);

    expect(pressed).toEqual([name]);
    expect(shown).toEqual({ kind, level: 0.4, muted });
  });

  it.each([MediaKey.VolumeUp, MediaKey.MicMute, MediaKey.BrightnessUp])(
    "shows nothing when key %d did nothing",
    (key) => {
      const { keys } = recording(false);

      expect(pressMediaKey(keys, key)).toBeUndefined();
    },
  );
});
