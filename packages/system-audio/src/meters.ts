// Level meters: one `parec` per metered id, sampled for its peak.
//
// `parec` cannot use the server's own peak detection, so it records 1000 mono
// samples a second and the peak is taken here.

import type { Subprocess } from "@domicile-desktop/sdk/system";

import type { Meter } from "./audio";
import { MeterKind } from "./audio";
import { C_LOCALE } from "./pactl";
import { peak } from "./peak";
import { METER_APPLICATION } from "./reading";
import type { AudioSystem, Levels, Meters, Report } from "./sound-server";

/** High enough to catch transients, low enough to run one per device. */
const RATE = 1000;

/** A running `parec`, and its peak since the last report. */
type Recording = {
  meter: Meter;
  /** `undefined` until it has read a sample. */
  loudest: number | undefined;
  /** Set once `parec` started. */
  process: Subprocess | undefined;
  stopped: boolean;
};

/** See `SoundServer.meters`. */
export const meters = (
  system: AudioSystem,
  onLevels: (levels: Levels) => void,
  tickMs: number,
  report: Report,
): Meters => {
  const running = new Map<string, Recording>();
  const said = { cannotRecord: false };
  const ticking = setInterval(() => {
    const levels = levelsOf(running);
    if (levels.size > 0) {
      onLevels(levels);
    }
  }, tickMs);
  return {
    // A meter whose source changed restarts: a stream moved to another
    // device keeps its id.
    meter: (wanted) => {
      for (const [id, recording] of running) {
        const meter = wanted.get(id);
        if (meter === undefined || !sameMeter(meter, recording.meter)) {
          stop(recording);
          running.delete(id);
        }
      }
      for (const [id, meter] of wanted) {
        if (!running.has(id)) {
          running.set(id, record(system, meter, report, said));
        }
      }
    },
    stop: () => {
      clearInterval(ticking);
      for (const recording of running.values()) {
        stop(recording);
      }
      running.clear();
    },
  };
};

/** `parec` arguments to record `meter` as mono floats, named as a meter. */
const argv = (meter: Meter): string[] => [
  "parec",
  meter.kind === MeterKind.Source
    ? `--device=${meter.name}`
    : `--monitor-stream=${meter.index.toString()}`,
  "--raw",
  "--format=float32le",
  "--channels=1",
  `--rate=${RATE.toString()}`,
  "--latency-msec=30",
  `--property=application.id=${METER_APPLICATION}`,
];

/** Starts a `parec` for `meter`. One that cannot start stays silent. */
const record = (
  system: AudioSystem,
  meter: Meter,
  report: Report,
  said: { cannotRecord: boolean },
): Recording => {
  const recording: Recording = {
    loudest: undefined,
    meter,
    process: undefined,
    stopped: false,
  };
  system
    .spawn(argv(meter), C_LOCALE)
    .then(async (started) => {
      await started.match({
        Err: (error) => {
          if (!said.cannotRecord) {
            said.cannotRecord = true;
            report(
              "the meters cannot record; they read nothing",
              error.message,
            );
          }
          return Promise.resolve();
        },
        Ok: (process) => {
          recording.process = process;
          if (recording.stopped) {
            process.kill();
          }
          return listen(process.stdout, recording);
        },
      });
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: a meter has no caller to return to
      console.error("a level meter broke", error);
    });
  return recording;
};

/** Keeps `recording.loudest` at the loudest sample `samples` carried. */
const listen = async (
  samples: ReadableStream<Uint8Array>,
  recording: Recording,
) => {
  let carried: Uint8Array = new Uint8Array();
  for await (const read of samples) {
    const { loudest, rest } = peak(carried, read);
    recording.loudest = Math.max(recording.loudest ?? 0, loudest);
    carried = rest;
  }
};

const stop = (recording: Recording) => {
  recording.stopped = true;
  recording.process?.kill();
};

/** Each meter's peak since the last call, resetting it. Silent ones are left out. */
const levelsOf = (running: ReadonlyMap<string, Recording>): Levels =>
  new Map(
    [...running].flatMap(([id, recording]) => {
      const loudest = recording.loudest;
      recording.loudest = loudest === undefined ? undefined : 0;
      return loudest === undefined ? [] : [[id, loudest] as const];
    }),
  );

const sameMeter = (a: Meter, b: Meter): boolean => {
  switch (a.kind) {
    case MeterKind.Source:
      return b.kind === MeterKind.Source && a.name === b.name;
    case MeterKind.Stream:
      return b.kind === MeterKind.Stream && a.index === b.index;
  }
};
