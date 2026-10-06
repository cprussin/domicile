// Watches the screen's backlight.
//
// inotify sees no change to a file under `/sys`, so the watch runs
// `udevadm monitor` and reads the backlight again on each kernel uevent.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  Exit,
  Subprocess,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { SysfsHost } from "./read-backlight";
import { levelOf, readBacklight } from "./read-backlight";

/** Prints a line for each backlight uevent. */
const UDEVADM = [
  "udevadm",
  "monitor",
  "--kernel",
  "--subsystem-match=backlight",
];

/** How often to read again without a uevent: firmware keys may send none. */
const BACKSTOP_MS = 120_000;

/** The calls {@link watchBrightness} makes. */
export type WatchHost = SysfsHost & Pick<System, "spawn">;

export type BrightnessWatch = {
  stop: () => void;
  /** `Ok` after {@link BrightnessWatch.stop}, `Err` if the watch broke. */
  ended: Promise<Result<"stopped", SystemError>>;
};

/**
 * Calls `onLevel` with the backlight's level from 0 to 1, now and after each
 * change.
 *
 * - Reports only a move of a whole percent, since the slider shows no finer.
 * - Never called on a machine without a backlight. A backlight that goes away
 *   and comes back is reported again.
 * - Runs `udevadm` from the compositor's `PATH`. Works while the desktop is
 *   locked.
 */
export const watchBrightness = async (
  host: WatchHost,
  onLevel: (level: number) => void,
  every: typeof everyInterval = everyInterval,
): Promise<Result<BrightnessWatch, SystemError>> =>
  (await host.spawn(UDEVADM)).map((udevadm) => {
    const watch: Watching = {
      failure: undefined,
      reading: Promise.resolve(),
      shown: undefined,
      stopped: false,
    };
    const reread = () => {
      watch.reading = watch.reading.then(() =>
        readOnce(host, watch, udevadm, onLevel),
      );
    };
    reread();
    const stopClock = every(BACKSTOP_MS, reread);
    return {
      ended: ended(udevadm, watch, reread, stopClock),
      stop: () => {
        watch.stopped = true;
        udevadm.kill();
      },
    };
  });

/** Calls `tick` every `ms`, until the returned function is called. */
const everyInterval = (ms: number, tick: () => void): (() => void) => {
  const id = setInterval(tick, ms);
  return () => {
    clearInterval(id);
  };
};

type Watching = {
  /** The level last reported, in whole percent; `undefined` with no backlight. */
  shown: number | undefined;
  /** The reads in order, so a slow one cannot report after a newer one. */
  reading: Promise<void>;
  stopped: boolean;
  failure: SystemError | undefined;
};

const readOnce = async (
  host: SysfsHost,
  watch: Watching,
  udevadm: Subprocess,
  onLevel: (level: number) => void,
): Promise<void> => {
  const read = await readBacklight(host);
  if (!watch.stopped && watch.failure === undefined) {
    read.match({
      Err: (error) => {
        watch.failure = error;
        udevadm.kill();
      },
      Ok: (backlight) => {
        const level = backlight.map(levelOf);
        const shown = level.match({
          None: () => undefined,
          Some: (now) => Math.round(now * 100),
        });
        if (shown !== watch.shown) {
          watch.shown = shown;
          level.match({ None: () => undefined, Some: onLevel });
        }
      },
    });
  }
};

/** Reads `udevadm`'s lines until it exits, then says why it did. */
const ended = async (
  udevadm: Subprocess,
  watch: Watching,
  reread: () => void,
  stopClock: () => void,
): Promise<Result<"stopped", SystemError>> => {
  await eachLine(udevadm.stdout, (line) => {
    if (line.startsWith("KERNEL[")) {
      reread();
    }
  });
  const exit = await udevadm.exited;
  stopClock();
  await watch.reading;
  if (watch.failure !== undefined) {
    return Err(watch.failure);
  } else if (watch.stopped) {
    return Ok("stopped");
  } else {
    return exit.andThen((exited) => Err(unexpectedExit(exited)));
  }
};

const eachLine = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let unfinished = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const lines = (unfinished + decoder.decode(value, { stream: true })).split(
      "\n",
    );
    unfinished = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  }
};

const unexpectedExit = ({ code, signal }: Exit): SystemError => ({
  kind: SystemErrorKind.Other,
  message:
    code === undefined
      ? `udevadm monitor was killed by signal ${signal}`
      : `udevadm monitor exited with code ${code}`,
});
