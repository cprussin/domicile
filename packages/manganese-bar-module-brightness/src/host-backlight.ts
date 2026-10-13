import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { system } from "@domicile-desktop/sdk/system";
import { brightnessSetter } from "@domicile-desktop/system-backlight/set-brightness";
import type { BrightnessWatch } from "@domicile-desktop/system-backlight/watch-brightness";
import { watchBrightness } from "@domicile-desktop/system-backlight/watch-brightness";

/** The backlight as the bar's brightness item uses it. */
export type Backlight = {
  /**
   * Calls `onLevel` with the level (0 to 1) now and after each change, and
   * returns a function that stops watching. Never called on a machine without
   * a backlight.
   */
  watch: (onLevel: (level: number) => void) => () => void;
  /** Ask for a level from 0 to 1. The watch reports it once it is set. */
  set: (level: number) => void;
};

/** The backlight through `domicile`'s system calls. Failures are logged. */
export const hostBacklight = (domicile: DomicileHost): Backlight => {
  const host = system(domicile);
  const set = brightnessSetter(host);
  return {
    set: (level) => {
      set(level)
        .then((result) => {
          result.match({ Err: logFailure("set"), Ok: () => undefined });
        })
        .catch(logFailure("set"));
    },
    watch: (onLevel) => {
      const started = watchBrightness(host, onLevel).then((result) =>
        result.match<BrightnessWatch | undefined>({
          Err: (error) => {
            logFailure("watch")(error);
            return undefined;
          },
          Ok: (watch) => {
            watch.ended
              .then((ended) => {
                ended.match({ Err: logFailure("watch"), Ok: () => undefined });
              })
              .catch(logFailure("watch"));
            return watch;
          },
        }),
      );
      return () => {
        started
          .then((watch) => {
            watch?.stop();
          })
          .catch(logFailure("watch"));
      };
    },
  };
};

const logFailure =
  (doing: "set" | "watch") =>
  (error: unknown): void => {
    // biome-ignore lint/suspicious/noConsole: the bar has nowhere else to say it
    console.error(`could not ${doing} the brightness`, error);
  };
