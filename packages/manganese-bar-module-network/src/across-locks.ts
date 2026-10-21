import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

/**
 * `start`, begun again each time the desktop unlocks.
 *
 * The compositor refuses the network service's calls while the desktop is
 * locked (docs/LOCK.md), and a refused read is not retried until the service
 * signals a change, which may be long after the unlock.
 */
export const watchAcrossLocks =
  <T>(
    domicile: DomicileHost,
    start: (onValue: (value: T) => void) => () => void,
  ) =>
  (onValue: (value: T) => void): (() => void) => {
    const watch = { locked: false, stop: start(onValue) };
    const stopHearing = watchHost(
      domicile,
      "lockedchanged",
      lockedOf,
      (locked) => {
        if (watch.locked && !locked) {
          watch.stop();
          watch.stop = start(onValue);
        }
        watch.locked = locked;
      },
    );
    return () => {
      stopHearing();
      watch.stop();
    };
  };

const lockedOf = ({ locked }: DomicileHost): boolean | undefined =>
  locked ?? undefined;
