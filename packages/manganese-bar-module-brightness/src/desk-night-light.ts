import { perDesktop } from "@domicile-desktop/react/per-desktop";

import { everyInterval } from "./every";
import type { NightLight } from "./night-light";
import { nightLight } from "./night-light";
import { storedOverride, storeOverride } from "./night-light-override";

/** The night light, shared by the desktop that runs it and every bar. */
export const deskNightLight = perDesktop(
  (domicile): NightLight =>
    nightLight({
      every: everyInterval,
      now: () => new Date(),
      store: storeOverride,
      stored: storedOverride,
      tint: (kelvin) => {
        domicile.displays
          .setColorTemperature(kelvin)
          .then((result) => {
            result.match({ Err: logFailure, Ok: () => undefined });
          })
          .catch(logFailure);
      },
    }),
);

const logFailure = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: a background tint has no caller to tell
  console.error("could not set the night light", error);
};
