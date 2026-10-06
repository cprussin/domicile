import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { AudioError } from "./audio-error";
import type { AudioSystem } from "./sound-server";

/**
 * The C locale, because some of `pactl`'s JSON values are read as English
 * words.
 */
export const C_LOCALE = { env: { LC_ALL: "C" } };

/** Runs `pactl args` and returns its output, or its error output as the error. */
export const pactl = async (
  system: AudioSystem,
  args: readonly string[],
): Promise<Result<string, AudioError>> =>
  (await system.run(["pactl", ...args], C_LOCALE))
    .mapErr((error): AudioError => AudioError.Refused(error.message))
    .andThen((ran) =>
      ran.code === 0
        ? Ok(ran.stdout)
        : Err(AudioError.Refused(ran.stderr.trim())),
    );
