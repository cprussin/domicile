import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

/** How often to look again: a device plugged in or out. */
const EVERY_MS = 10_000;

/**
 * Calls `onPresent` with `read` now and whenever it changes, and returns a
 * function that stops watching. For whether a bar item's hardware exists, read
 * from `/sys`, which works while the desktop is locked.
 */
export const watchPresence = (
  read: () => Promise<Result<boolean, SystemError>>,
  onPresent: (present: Result<boolean, SystemError>) => void,
  every: typeof everyInterval = everyInterval,
): (() => void) => {
  const watch: { shown: string | undefined; stopped: boolean } = {
    shown: undefined,
    stopped: false,
  };
  const look = () => {
    read()
      .then((present) => {
        const shown = JSON.stringify(
          present.match<unknown>({
            Err: (error) => error,
            Ok: (found) => found,
          }),
        );
        if (!watch.stopped && shown !== watch.shown) {
          watch.shown = shown;
          onPresent(present);
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a background failure; the next look reads again
        console.error("Failed to look for a bar item's hardware", error);
      });
  };
  look();
  const stopClock = every(EVERY_MS, look);
  return () => {
    watch.stopped = true;
    stopClock();
  };
};

/**
 * Whether a bar item hides for want of its hardware: not looked for yet, or
 * not there. A failed look shows the item, since the hardware may be there.
 */
export const isAbsent = (
  present: Result<boolean, SystemError> | undefined,
): boolean =>
  present === undefined ||
  present.match({ Err: () => false, Ok: (has) => !has });

const everyInterval = (ms: number, tick: () => void): (() => void) => {
  const id = setInterval(tick, ms);
  return () => {
    clearInterval(id);
  };
};
