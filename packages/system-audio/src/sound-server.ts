// The sound server (PulseAudio or PipeWire) for a shell's mixer, through
// `pactl` and `parec` run by `@domicile-desktop/sdk/system`.
//
// - `pactl` and `parec` work with both PulseAudio and `pipewire-pulse`. The
//   compositor's `PATH` must have them.
// - Requests run one at a time, in order, so the last volume a slider sent is
//   the one the server keeps.

import type { Result } from "@cprussin/option-result";
import type { System } from "@domicile-desktop/sdk/system";

import type { Asked } from "./asked";
import type { Audio, Meter } from "./audio";
import type { AudioError } from "./audio-error";
import { meters } from "./meters";
import { Request } from "./request";
import { requestQueue } from "./request-queue";
import { watchAudio } from "./watch-audio";

/** The system calls this library uses. */
export type AudioSystem = Pick<System, "run" | "spawn">;

/** Each meter's loudest sample since the last report, 0 through 1, by id. */
export type Levels = ReadonlyMap<string, number>;

/** Running meters. Metering a microphone records it: stop when not shown. */
export type Meters = {
  /** Meter these ids from these sources, and stop metering the rest. */
  meter: (wanted: ReadonlyMap<string, Meter>) => void;
  stop: () => void;
};

/** Ids come from {@link SoundServer.watch}; volumes are fractions of 100%. */
export type SoundServer = {
  /**
   * Calls `onAudio` with the server's state and again after each change.
   * Never calls it without a sound server. Returns a stop function.
   */
  watch: (onAudio: (audio: Audio) => void) => () => void;
  /** Kept between 0 and 1.5, pavucontrol's maximum. */
  setVolume: (id: string, volume: number) => Promise<Result<Asked, AudioError>>;
  setMuted: (id: string, muted: boolean) => Promise<Result<Asked, AudioError>>;
  /** Make a device the default for new streams. */
  setDefault: (id: string) => Promise<Result<Asked, AudioError>>;
  /** Move a stream to a device of its own direction. */
  moveStream: (
    id: string,
    device: string,
  ) => Promise<Result<Asked, AudioError>>;
  setPort: (id: string, port: string) => Promise<Result<Asked, AudioError>>;
  setProfile: (
    card: string,
    profile: string,
  ) => Promise<Result<Asked, AudioError>>;
  /** Level meters, reported to `onLevels` while any is running. */
  meters: (onLevels: (levels: Levels) => void) => Meters;
};

/** How long to wait; shortened by tests. */
export type Timing = {
  /** Quiet after a change before the server is read again. */
  settleMs: number;
  /** Delay before subscribing again after a subscription ends. */
  reopenMs: number;
  /** Interval between meter reports. */
  tickMs: number;
};

/** Says that something keeps failing in the background. */
export type Report = (message: string, detail: unknown) => void;

const TIMING: Timing = { reopenMs: 5000, settleMs: 30, tickMs: 50 };

/** The sound server, reached through `system`. */
export const soundServer = (
  system: AudioSystem,
  timing: Timing = TIMING,
  report: Report = warn,
): SoundServer => {
  const ask = requestQueue(system);
  return {
    meters: (onLevels) => meters(system, onLevels, timing.tickMs, report),
    moveStream: (id, device) => ask(Request.Move(id, device)),
    setDefault: (id) => ask(Request.Default(id)),
    setMuted: (id, muted) => ask(Request.Muted(id, muted)),
    setPort: (id, port) => ask(Request.Port(id, port)),
    setProfile: (card, profile) => ask(Request.Profile(card, profile)),
    setVolume: (id, volume) => ask(Request.Volume(id, volume)),
    watch: (onAudio) => watchAudio(system, onAudio, timing, report),
  };
};

const warn: Report = (message, detail) => {
  // biome-ignore lint/suspicious/noConsole: background failures have no caller to return to
  console.warn(message, detail);
};
