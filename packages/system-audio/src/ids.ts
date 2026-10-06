// The kinds of thing an id names, and the ids themselves: the kind's prefix,
// a colon, then a device name or stream index.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { AudioError } from "./audio-error";

export enum Target {
  Output,
  Input,
  Playback,
  Recording,
}

export const targetId = (target: Target, key: string | number): string =>
  `${prefix(target)}:${key.toString()}`;

/**
 * Splits an id into its target and key. A stream's key must be its index, or
 * `pactl` would look it up as a name.
 */
export const parseId = (
  id: string,
): Result<{ target: Target; key: string }, AudioError> => {
  const colon = id.indexOf(":");
  const target = TARGETS.find(
    (candidate) => prefix(candidate) === id.slice(0, colon),
  );
  const key = id.slice(colon + 1);
  return colon === -1 || target === undefined || !fits(target, key)
    ? Err(AudioError.UnknownId(id))
    : Ok({ key, target });
};

const TARGETS = [
  Target.Output,
  Target.Input,
  Target.Playback,
  Target.Recording,
] as const;

const fits = (target: Target, key: string): boolean =>
  target === Target.Playback || target === Target.Recording
    ? /^\d+$/.test(key)
    : key !== "";

const prefix = (target: Target): string => {
  switch (target) {
    case Target.Output:
      return "output";
    case Target.Input:
      return "input";
    case Target.Playback:
      return "playback";
    case Target.Recording:
      return "recording";
  }
};
