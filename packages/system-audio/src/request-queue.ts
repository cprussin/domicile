import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { Asked } from "./asked";
import type { AudioError } from "./audio-error";
import { pactl } from "./pactl";
import type { Request } from "./request";
import { argv, coalesce } from "./request";
import type { AudioSystem } from "./sound-server";

type Waiting = {
  request: Request;
  args: readonly string[];
  answer: (asked: Result<Asked, AudioError>) => void;
};

/**
 * Runs requests one at a time, in order. Requests that wait while another
 * runs are coalesced: see {@link coalesce}.
 */
export const requestQueue = (system: AudioSystem) => {
  const waiting: Waiting[] = [];
  const state = { running: false };
  return (request: Request): Promise<Result<Asked, AudioError>> =>
    argv(request).match({
      Err: (error) => Promise.resolve(Err(error)),
      Ok: (args) =>
        new Promise((answer) => {
          waiting.push({ answer, args, request });
          if (!state.running) {
            state.running = true;
            drain(system, waiting, state).catch((error: unknown) => {
              // biome-ignore lint/suspicious/noConsole: no caller is waiting on the queue itself
              console.error("the mixer's request queue broke", error);
            });
          }
        }),
    });
};

/** Runs what is waiting, then marks the queue idle in the same turn. */
const drain = async (
  system: AudioSystem,
  waiting: Waiting[],
  state: { running: boolean },
) => {
  while (waiting.length > 0) {
    const batch = waiting.splice(0);
    const kept = coalesce(batch.map(({ request }) => request));
    for (const { answer, args, request } of batch) {
      answer(
        kept.includes(request)
          ? (await pactl(system, args)).map(() => Asked.Done)
          : Ok(Asked.Overtaken),
      );
    }
  }
  state.running = false;
};
