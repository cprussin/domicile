// A client of `domicile-app-host`, the process an app module spawns for what
// its sandbox cannot reach. They speak framed JSON (`./frames`) on its stdin
// and stdout. The protocol is `domicile_launch::app_host`'s: each request
// carries an `id`, and the host answers it with a reply of the same `id`, or
// `refused` with why. A message without an `id` is an event.

import type { Result } from "@cprussin/option-result";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type {
  Exit,
  Subprocess,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { encodeFrame, frameDecoder } from "./frames";

/** The command that starts the host. */
export const HOST = ["domicile-app-host"];

/** A reply the host gives to one request. */
export type Reply = { id: number; type: string };

/** The host, as an app asks it things. */
export type AppHost<R extends Reply> = {
  /**
   * Sends `request` and resolves with its reply, which must be of the
   * `wanted` type. Rejects with the host's reason when it refuses, or with
   * why the host ended before it answered.
   */
  ask: <Type extends R["type"]>(
    request: { type: string } & Record<string, unknown>,
    wanted: Type,
  ) => Promise<Extract<R, { type: Type }>>;
  /**
   * Starts the host if it is not running, so its events arrive before the
   * app asks anything. A failed start fails the requests made with it.
   */
  start: () => void;
};

/** What `spawnedAppHost` needs. */
export type Options<R extends Reply> = {
  processes: Pick<Processes, "spawn">;
  /** Every reply this app's requests can get, but `refused`. */
  replies: z.ZodType<R>;
  /**
   * Hears each event: a message without an `id`. Without it an event is a
   * bad message.
   */
  onEvent?: ((message: unknown) => void) | undefined;
};

/**
 * The host as a process the app spawns. It starts on the first request, and
 * again after it ends. A message the app cannot read, or a reply to nothing it
 * asked, stops the host.
 */
export const spawnedAppHost = <R extends Reply>({
  onEvent,
  processes,
  replies,
}: Options<R>): AppHost<R> => {
  const pending = new Map<number, Pending<R>>();
  let running: Promise<Subprocess> | undefined;
  let lastId = 0;

  const ended = (why: Error) => {
    running = undefined;
    for (const waiting of pending.values()) {
      waiting.reject(why);
    }
    pending.clear();
  };

  const received = (message: unknown) => {
    if (isEvent(message)) {
      if (onEvent === undefined) {
        throw new Error("The app host sent an event this app does not hear");
      } else {
        onEvent(message);
      }
    } else {
      const refusal = refusedSchema.safeParse(message);
      if (refusal.success) {
        settled(refusal.data.id).reject(new Error(refusal.data.why));
      } else {
        const reply = replies.parse(message);
        settled(reply.id).resolve(reply);
      }
    }
  };

  /** Takes the request `id` answers off the waiting list. */
  const settled = (id: number): Pending<R> => {
    const waiting = pending.get(id);
    if (waiting === undefined) {
      throw new Error(`The app host answered ${String(id)}, never asked`);
    } else {
      pending.delete(id);
      return waiting;
    }
  };

  const connected = (): Promise<Subprocess> => {
    if (running === undefined) {
      const starting = processes.spawn(HOST, { stdin: true }).then((spawned) =>
        spawned.match({
          Err: (error) => {
            running = undefined;
            throw new Error(error.message);
          },
          Ok: (process) => {
            follow(process, received).then(ended, (error: unknown) => {
              ended(new Error("The app host stopped", { cause: error }));
            });
            return process;
          },
        }),
      );
      running = starting;
      return starting;
    } else {
      return running;
    }
  };

  return {
    ask: async (request, wanted) => {
      const reply = await new Promise<R>((resolve, reject) => {
        lastId += 1;
        const id = lastId;
        pending.set(id, { reject, resolve });
        connected().then(
          (process) => {
            process.write(encodeFrame({ ...request, id }));
          },
          (error: unknown) => {
            pending.delete(id);
            reject(error);
          },
        );
      });
      if (isOfType(reply, wanted)) {
        return reply;
      } else {
        throw new Error(
          `The app host answered ${reply.type}, not ${String(wanted)}`,
        );
      }
    },
    start: () => {
      connected().catch(() => {
        /* reported by the requests */
      });
    },
  };
};

/** A request waiting for its reply. */
type Pending<R> = {
  reject: (error: Error) => void;
  resolve: (reply: R) => void;
};

const refusedSchema = z.object({
  id: z.number(),
  type: z.literal("refused"),
  why: z.string(),
});

/** Whether `message` is an event: an object without an `id`. */
const isEvent = (message: unknown): boolean =>
  typeof message === "object" && message !== null && !("id" in message);

const isOfType = <R extends Reply, Type extends R["type"]>(
  reply: R,
  type: Type,
): reply is Extract<R, { type: Type }> => reply.type === type;

/**
 * Hands each message `process` writes to `received` until it ends, and
 * resolves with why it ended. A message `received` throws on stops it.
 */
const follow = async (
  process: Subprocess,
  received: (message: unknown) => void,
): Promise<Error> => {
  const decode = frameDecoder();
  const [broken, stderr, exit] = await Promise.all([
    eachChunk(process.stdout, (chunk) => {
      for (const message of decode(chunk)) {
        received(message);
      }
    }).then(
      () => undefined,
      (error: unknown) => {
        process.kill();
        return new Error("The app host sent a bad message", { cause: error });
      },
    ),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return broken ?? new Error(whyEnded(stderr, exit));
};

/** Why the host ended: what it said on stderr, or how it exited. */
const whyEnded = (stderr: string, exit: Result<Exit, SystemError>): string =>
  stderr.trim() === ""
    ? exit.match({
        Err: (error) => error.message,
        Ok: ({ code, signal }) =>
          signal === undefined
            ? `The app host exited with code ${String(code)}`
            : `The app host was killed by signal ${String(signal)}`,
      })
    : stderr.trim();

/** Calls `each` with every chunk `stream` reads, until it closes. */
const eachChunk = async (
  stream: ReadableStream<Uint8Array>,
  each: (chunk: Uint8Array) => void,
) => {
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    each(read.value);
  }
};
