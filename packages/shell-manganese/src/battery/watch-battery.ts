/** The battery as the page can read it: whether AC is in, and how full. */
export type BatteryReading = {
  charging: boolean;
  /** 0 through 1, which is the scale the API reports on. */
  level: number;
};

/**
 * Watch the machine's battery: `onReading` is called with the charge as soon
 * as the platform has answered and again on every change, and what comes back
 * stops it.
 *
 * @param battery - The platform's own battery. Injected so a test can hand
 *   over one it drives.
 */
export const watchBattery = (
  onReading: (reading: BatteryReading) => void,
  battery: typeof platformBattery = platformBattery,
): (() => void) => {
  const watching = new AbortController();
  battery()
    .then((manager) => {
      const report = () => {
        onReading({ charging: manager.charging, level: manager.level });
      };
      // The signal is the whole teardown: the listeners come off with it, and
      // an abort that landed while the platform was still answering is what
      // keeps the first reading from arriving after the watcher was stopped.
      manager.addEventListener("chargingchange", report, {
        signal: watching.signal,
      });
      manager.addEventListener("levelchange", report, {
        signal: watching.signal,
      });
      if (!watching.signal.aborted) {
        report();
      }
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error("Failed to read the battery", error);
    });
  return () => {
    watching.abort();
  };
};

/**
 * The battery the page is running on.
 *
 * A browser without the API is a failure rather than a machine without a
 * battery: a laptop with the lead out and a desktop with no cell both answer,
 * the second of them as full and on AC forever.
 */
const platformBattery = (): Promise<BatteryManager> => {
  if (navigator.getBattery === undefined) {
    throw new Error(
      "This browser has no Battery Status API, so the desktop cannot read the charge",
    );
  } else {
    return navigator.getBattery();
  }
};
