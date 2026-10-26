import type { AudioDevice } from "@domicile-desktop/system-audio/audio";
import type { DeskSound } from "@domicile-desktop/system-audio/react";
import { useEffect, useMemo } from "react";
import { ask } from "./ask";
import { primary } from "./primary";

/** How far one press moves the volume. Matches the wheel over the bar's icon. */
const STEP = 0.05;

/** A device's volume and mute after a press asked for them. */
export type AskedLevel = { level: number; muted: boolean };

/**
 * What the volume and microphone keys do. Each returns what it asked for, or
 * `undefined` when it did nothing.
 */
export type VolumeKeys = {
  up: () => AskedLevel | undefined;
  down: () => AskedLevel | undefined;
  /** Toggles the default output's mute. */
  mute: () => AskedLevel | undefined;
  /** Toggles the default microphone's mute. */
  micMute: () => AskedLevel | undefined;
};

/**
 * The volume and microphone keys, acting on the default devices.
 *
 * Holds the sound server's watch while mounted, so a press reads the latest
 * state even when no bar shows the volume. A press before the server reports
 * does nothing.
 */
export const useVolumeKeys = ({ audio, sound }: DeskSound): VolumeKeys => {
  useEffect(() => audio.subscribe(() => undefined), [audio]);

  return useMemo(() => {
    const output = () => primary(audio.current()?.outputs ?? []);
    const microphone = () =>
      primary(audio.current()?.inputs.filter((input) => !input.monitor) ?? []);
    const step = (by: number) => {
      const device = output();
      if (device === undefined) {
        return undefined;
      } else {
        const level = stepped(device, by);
        ask(sound.setVolume(device.id, level));
        return { level, muted: device.muted };
      }
    };
    const toggleMute = (device: AudioDevice | undefined) => {
      if (device === undefined) {
        return undefined;
      } else {
        ask(sound.setMuted(device.id, !device.muted));
        return { level: device.volume, muted: !device.muted };
      }
    };
    return {
      down: () => step(-STEP),
      micMute: () => toggleMute(microphone()),
      mute: () => toggleMute(output()),
      up: () => step(STEP),
    };
  }, [audio, sound]);
};

const stepped = ({ volume }: AudioDevice, by: number) =>
  Math.min(1, Math.max(0, Math.round((volume + by) * 100) / 100));
