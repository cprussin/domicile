import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";

import type { Backlight } from "./host-backlight";

/** The backlight's level, shared, and the ways to change it. */
export type SharedBacklight = {
  /** 0 to 1. Never reported on a machine without a backlight. */
  level: SharedWatch<number>;
  /** Ask for a level from 0 to 1 the user chose. `level` reports it once it is set. */
  set: (level: number) => void;
  /** Ask for a level automatic brightness chose. */
  adjust: (level: number) => void;
  /** Hear each level the user chose with `set`. Returns what stops it. */
  chosen: (listener: (level: number) => void) => () => void;
};

/**
 * `backlight`, watched once for every reader. `set` and `adjust` share its
 * one setter, so a level the user chose is never overtaken by an older
 * automatic one.
 */
export const sharedBacklight = (backlight: Backlight): SharedBacklight => {
  const listeners = new Set<(level: number) => void>();
  return {
    adjust: backlight.set,
    chosen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    level: sharedWatch(backlight.watch),
    set: (level) => {
      backlight.set(level);
      for (const listener of listeners) {
        listener(level);
      }
    },
  };
};
