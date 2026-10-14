import { describe, expect, it } from "bun:test";
import { MediaKey } from "@domicile-desktop/manganese-window-management/keyboard/media-key";

import { pressMediaKey } from "./media-keys";

/** Keys that record which of them was pressed. */
const recording = () => {
  const pressed: string[] = [];
  const press = (name: string) => () => {
    pressed.push(name);
  };
  return {
    keys: {
      brightness: {
        down: press("brightness down"),
        up: press("brightness up"),
      },
      volume: {
        down: press("volume down"),
        micMute: press("mic mute"),
        mute: press("volume mute"),
        up: press("volume up"),
      },
    },
    pressed,
  };
};

describe("pressMediaKey", () => {
  it.each([
    [MediaKey.VolumeUp, "volume up"],
    [MediaKey.VolumeDown, "volume down"],
    [MediaKey.VolumeMute, "volume mute"],
    [MediaKey.MicMute, "mic mute"],
    [MediaKey.BrightnessUp, "brightness up"],
    [MediaKey.BrightnessDown, "brightness down"],
  ])("presses key %d as %s", (key, name) => {
    const { keys, pressed } = recording();

    pressMediaKey(keys, key);

    expect(pressed).toEqual([name]);
  });
});
