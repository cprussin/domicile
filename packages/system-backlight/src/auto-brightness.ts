import { brightnessFor, offsetFor } from "./auto-brightness-curve";
import type { Every } from "./every";
import { everyInterval } from "./every";
import type { AmbientLight } from "./host-ambient-light";
import { learnedOffset, learnOffset } from "./learned-offset";
import type { SharedBacklight } from "./shared-backlight";

/** The most one step of a ramp moves the level. */
const STEP = 0.01;

/** How often a ramp steps: from dark to full in about ten seconds. */
const STEP_MS = 100;

/** How far the room's level must move from the screen's before it follows. */
const HYSTERESIS = 0.03;

/** What {@link runAutoBrightness} stores the learned offset with. */
export type OffsetStore = {
  learned: () => number;
  learn: (offset: number) => void;
};

const localOffset: OffsetStore = {
  learn: learnOffset,
  learned: learnedOffset,
};

/**
 * Follows the room's light with the backlight until the returned function
 * stops it, as macOS does: the level eases toward the curve's, and a level the
 * user chose moves the curve, so the next room keeps their preference.
 *
 * Small changes in the light are ignored, so the screen does not flicker with
 * the sensor's noise. Does nothing without a sensor or a backlight.
 */
export const runAutoBrightness = (
  backlight: SharedBacklight,
  light: AmbientLight,
  every: Every = everyInterval,
  store: OffsetStore = localOffset,
): (() => void) => {
  const state: {
    lux: number | undefined;
    offset: number;
    // The level last asked for, so a backlight's coarse steps are not read
    // as the room changing.
    position: number | undefined;
    stopRamp: (() => void) | undefined;
  } = {
    lux: undefined,
    offset: store.learned(),
    position: undefined,
    stopRamp: undefined,
  };

  const stopRamp = () => {
    state.stopRamp?.();
    state.stopRamp = undefined;
  };

  const aim = () => {
    const from = state.position ?? backlight.level.current();
    if (state.lux !== undefined && from !== undefined) {
      const target = brightnessFor(state.lux, state.offset);
      if (Math.abs(target - from) >= HYSTERESIS) {
        stopRamp();
        state.position = from;
        state.stopRamp = every(STEP_MS, () => {
          const at = state.position ?? from;
          const next =
            Math.abs(target - at) <= STEP
              ? target
              : at + Math.sign(target - at) * STEP;
          state.position = next;
          backlight.adjust(next);
          if (next === target) {
            stopRamp();
          }
        });
      }
    }
  };

  const stopLevel = backlight.level.subscribe(() => {
    if (state.position === undefined) {
      aim();
    }
  });
  const stopChosen = backlight.chosen((level) => {
    stopRamp();
    state.position = level;
    if (state.lux !== undefined) {
      state.offset = offsetFor(state.lux, level);
      store.learn(state.offset);
    }
  });
  const stopLight = light((lux) => {
    state.lux = lux;
    aim();
  });

  return () => {
    stopRamp();
    stopLight();
    stopChosen();
    stopLevel();
  };
};
