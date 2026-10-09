// Polls the `progress.json` that `domicile` writes beside the splash.

import type { Progress } from "./progress";
import { progressSchema } from "./progress";

/** How often to read the progress. Fast enough that a step never lags. */
const POLL_MS = 150;

/**
 * Calls `onProgress` with each read of the progress until the returned
 * function is called.
 *
 * A failed read goes to `report` and is tried again on the next poll.
 */
export const followProgress = (
  onProgress: (progress: Progress) => void,
  read: () => Promise<unknown> = readProgress,
  every: number = POLL_MS,
  report: (error: unknown) => void = logToConsole,
): (() => void) => {
  const following: {
    stopped: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
  } = { stopped: false, timer: undefined };
  const poll = () => {
    read()
      .then((raw) => {
        if (!following.stopped) {
          onProgress(progressSchema.parse(raw));
        }
      })
      .catch(report)
      .finally(() => {
        if (!following.stopped) {
          following.timer = setTimeout(poll, every);
        }
      });
  };
  poll();
  return () => {
    following.stopped = true;
    clearTimeout(following.timer);
  };
};

/**
 * The file, relative to the splash's document. Fetched past the cache, since
 * it changes under the same URL.
 */
const readProgress = async (): Promise<unknown> => {
  const response = await fetch("progress.json", { cache: "no-store" });
  return response.json();
};

const logToConsole = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the splash has nowhere else to report a read it will retry
  console.error("could not read the build's progress", error);
};
