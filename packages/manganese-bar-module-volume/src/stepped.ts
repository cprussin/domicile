import type { AudioDevice } from "@domicile-desktop/system-audio/audio";
import type { WheelEvent } from "react";

/** How far one notch of the wheel moves the volume. */
const WHEEL_STEP = 0.05;

/** The output's volume after one wheel notch, rounded and clamped to 0–1. */
export const stepped = (output: AudioDevice, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(
    1,
    Math.max(0, Math.round((output.volume + step) * 100) / 100),
  );
};
