import { perHost } from "../host/per-host";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";
import { hostBacklight } from "./host-backlight";

/** The backlight's level, shared, and a way to change it. */
export type SharedBacklight = {
  /** 0 to 1. Never reported on a machine without a backlight. */
  level: SharedWatch<number>;
  /** Ask for a level from 0 to 1. `level` reports it once it is set. */
  set: (level: number) => void;
};

/** The backlight, watched once for every bar and the lock screen. */
export const deskBacklight = perHost((domicile): SharedBacklight => {
  const backlight = hostBacklight(domicile);
  return { level: sharedWatch(backlight.watch), set: backlight.set };
});
