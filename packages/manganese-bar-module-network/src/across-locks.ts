import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";

/**
 * `start`, begun again each time the desktop unlocks.
 *
 * The compositor refuses the network service's calls while the desktop is
 * locked (docs/LOCK.md), and a refused read is not retried until the service
 * signals a change, which may be long after the unlock.
 */
export const watchAcrossLocks =
  <T>(
    domicile: Pick<Domicile, "session">,
    start: (onValue: (value: T) => void) => () => void,
  ) =>
  (onValue: (value: T) => void): (() => void) => {
    const watch = { locked: false, stop: start(onValue) };
    const { session } = domicile;
    const stopHearing = watchHost(
      (changed) => session.on("lockchange", changed),
      () => session.locked,
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
