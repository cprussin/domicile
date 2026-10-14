import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { device, heldSound, laptop } from "./fixture";
import { useVolumeKeys } from "./useVolumeKeys";

/** The keys on `audio`, with no bar showing the volume. */
const keysOn = (audio: typeof laptop) => {
  const sound = heldSound();
  const { result } = renderHook(() =>
    useVolumeKeys({ audio: sound.audio, sound: sound.server }),
  );
  sound.report(audio);
  return { asked: sound.asked, keys: result.current };
};

/** `laptop` with its default output at `volume`. */
const speakersAt = (volume: number) => ({
  ...laptop,
  outputs: [device({ default: true, volume })],
});

describe("useVolumeKeys", () => {
  it("steps the default output's volume by 5%", () => {
    const { asked, keys } = keysOn(laptop);

    keys.up();
    keys.down();

    expect(asked).toEqual([
      ["setVolume", "output:speakers", 0.55],
      ["setVolume", "output:speakers", 0.45],
    ]);
  });

  it("keeps the volume between 0 and 100%", () => {
    const loud = keysOn(speakersAt(0.98));
    const quiet = keysOn(speakersAt(0.02));

    loud.keys.up();
    quiet.keys.down();

    expect([...loud.asked, ...quiet.asked]).toEqual([
      ["setVolume", "output:speakers", 1],
      ["setVolume", "output:speakers", 0],
    ]);
  });

  it("toggles the mute of the default output and the microphone", () => {
    const { asked, keys } = keysOn(laptop);

    keys.mute();
    keys.micMute();

    expect(asked).toEqual([
      ["setMuted", "output:speakers", true],
      ["setMuted", "input:mic", true],
    ]);
  });

  it("does nothing before the sound server reports", () => {
    const sound = heldSound();
    const { result } = renderHook(() =>
      useVolumeKeys({ audio: sound.audio, sound: sound.server }),
    );

    result.current.up();
    result.current.mute();

    expect(sound.asked).toEqual([]);
  });
});
