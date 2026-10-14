import type { AudioDevice } from "@domicile-desktop/system-audio/audio";
import { useEffect, useMemo } from "react";

import { ask } from "./ask";
import type { DeskSound } from "./desk-sound";
import { primary } from "./primary";

/** How far one press moves the volume. Matches the wheel over the bar's icon. */
const STEP = 0.05;

/** What the volume and microphone keys do. */
export type VolumeKeys = {
  up: () => void;
  down: () => void;
  /** Toggles the default output's mute. */
  mute: () => void;
  /** Toggles the default microphone's mute. */
  micMute: () => void;
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
      if (device !== undefined) {
        ask(sound.setVolume(device.id, stepped(device, by)));
      }
    };
    const toggleMute = (device: AudioDevice | undefined) => {
      if (device !== undefined) {
        ask(sound.setMuted(device.id, !device.muted));
      }
    };
    return {
      down: () => {
        step(-STEP);
      },
      micMute: () => {
        toggleMute(microphone());
      },
      mute: () => {
        toggleMute(output());
      },
      up: () => {
        step(STEP);
      },
    };
  }, [audio, sound]);
};

const stepped = ({ volume }: AudioDevice, by: number) =>
  Math.min(1, Math.max(0, Math.round((volume + by) * 100) / 100));
