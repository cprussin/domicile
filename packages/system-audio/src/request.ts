// What a mixer asks the sound server, and the `pactl` arguments for it.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { AudioError } from "./audio-error";
import { parseId, Target } from "./ids";
import { NORMAL } from "./reading";

/** The highest volume a mixer may set: 150%, matching pavucontrol. */
const CEILING = 1.5;

export enum RequestKind {
  Volume,
  Muted,
  Default,
  Move,
  Port,
  Profile,
}

export const Request = {
  Default: (id: string) => ({ id, kind: RequestKind.Default as const }),
  Move: (id: string, device: string) => ({
    device,
    id,
    kind: RequestKind.Move as const,
  }),
  Muted: (id: string, muted: boolean) => ({
    id,
    kind: RequestKind.Muted as const,
    muted,
  }),
  Port: (id: string, port: string) => ({
    id,
    kind: RequestKind.Port as const,
    port,
  }),
  Profile: (card: string, profile: string) => ({
    card,
    kind: RequestKind.Profile as const,
    profile,
  }),
  Volume: (id: string, volume: number) => ({
    id,
    kind: RequestKind.Volume as const,
    volume,
  }),
};

export type Request = ReturnType<(typeof Request)[keyof typeof Request]>;

/**
 * `pactl` arguments for `request`. They start with `--` so a name cannot be
 * read as an option.
 */
export const argv = (request: Request): Result<string[], AudioError> =>
  words(request).map((args) => ["--", ...args]);

/**
 * Drops each volume request whose next request for the same target is also a
 * volume. A dragged slider sends many requests a second; only the last
 * matters.
 */
export const coalesce = (requests: readonly Request[]): Request[] =>
  requests.filter((request, at) => {
    const next = requests
      .slice(at + 1)
      .find((later) => subject(later) === subject(request));
    return !(
      request.kind === RequestKind.Volume && next?.kind === RequestKind.Volume
    );
  });

const words = (request: Request): Result<string[], AudioError> => {
  switch (request.kind) {
    case RequestKind.Volume:
      return rawVolume(request.volume).andThen((raw) =>
        parseId(request.id).map(({ key, target }) => [
          `set-${noun(target)}-volume`,
          key,
          raw.toString(),
        ]),
      );
    case RequestKind.Muted:
      return parseId(request.id).map(({ key, target }) => [
        `set-${noun(target)}-mute`,
        key,
        request.muted ? "1" : "0",
      ]);
    case RequestKind.Default:
      return device(request.id).map(({ key, target }) => [
        `set-default-${noun(target)}`,
        key,
      ]);
    case RequestKind.Move:
      return parseId(request.id).andThen((stream) =>
        device(request.device).andThen((to) =>
          moveVerb(stream.target, to.target).match({
            Err: () => Err(AudioError.Mismatched(request.id, request.device)),
            Ok: (verb) => Ok([verb, stream.key, to.key]),
          }),
        ),
      );
    case RequestKind.Port:
      return device(request.id).map(({ key, target }) => [
        `set-${noun(target)}-port`,
        key,
        request.port,
      ]);
    case RequestKind.Profile:
      return Ok(["set-card-profile", request.card, request.profile]);
  }
};

/** The id or card a request is about, for {@link coalesce}. */
const subject = (request: Request): string =>
  request.kind === RequestKind.Profile ? request.card : request.id;

const rawVolume = (volume: number): Result<number, AudioError> =>
  Number.isFinite(volume)
    ? Ok(Math.round(Math.min(Math.max(volume, 0), CEILING) * NORMAL))
    : Err(AudioError.NotANumber());

/** Parses an id that must name a device. */
const device = (
  id: string,
): Result<{ target: Target; key: string }, AudioError> =>
  parseId(id).andThen((parsed) =>
    parsed.target === Target.Output || parsed.target === Target.Input
      ? Ok(parsed)
      : Err(AudioError.NotADevice(id)),
  );

const moveVerb = (
  stream: Target,
  device: Target,
): Result<string, "mismatched"> => {
  if (stream === Target.Playback && device === Target.Output) {
    return Ok("move-sink-input");
  } else if (stream === Target.Recording && device === Target.Input) {
    return Ok("move-source-output");
  } else {
    return Err("mismatched");
  }
};

/** The `pactl` name for a target. */
const noun = (target: Target): string => {
  switch (target) {
    case Target.Output:
      return "sink";
    case Target.Input:
      return "source";
    case Target.Playback:
      return "sink-input";
    case Target.Recording:
      return "source-output";
  }
};
