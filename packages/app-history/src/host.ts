// `domicile-app-host`, the process the app runs, as History uses it: the
// browser's history, its browsing data and its windows. Every reply is parsed.
// The protocol is `domicile_launch::app_host`'s.

import type { Result } from "@cprussin/option-result";
import {
  encodeFrame,
  frameDecoder,
} from "@domicile-desktop/component-library/app-host-frames";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type {
  Exit,
  Subprocess,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { z } from "zod";

import type { HistoryItem, PageQuery } from "./history-page";

/** The command that starts the host. */
const HOST = ["domicile-app-host"];

/** What `clear_browsing_data` removes. */
export type ClearRequest = {
  /** Only data changed since this time. */
  since: number;
  /** `DataTypeSet` names; see `clear-data.ts`. */
  types: readonly string[];
  /** Only these origins' data; every origin's when absent. */
  origins?: readonly string[];
};

/** What the app asks of the browser. */
export type HistoryHost = {
  /**
   * Pages with a visit before `endTime` whose title or URL matches `text`,
   * ordered by their latest such visit, newest first.
   */
  history: (query: PageQuery) => Promise<HistoryItem[]>;
  /** The times of every visit to `url`. */
  visits: (url: string) => Promise<number[]>;
  /** Removes the visits at these times. */
  deleteHistory: (visits: readonly number[]) => Promise<void>;
  clearBrowsingData: (request: ClearRequest) => Promise<void>;
  /** Opens `url` in a browser window. */
  openUrl: (url: string) => Promise<void>;
};

/**
 * The host as a process the app spawns, speaking framed JSON on its stdin and
 * stdout. It starts on the first request, and again after it ends.
 */
export const spawnedHost = (
  processes: Pick<Processes, "spawn">,
): HistoryHost => {
  const pending = new Map<number, Pending>();
  let running: Promise<Subprocess> | undefined;
  let lastId = 0;

  const ended = (why: Error) => {
    running = undefined;
    for (const waiting of pending.values()) {
      waiting.reject(why);
    }
    pending.clear();
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
            follow(process, (message) => {
              received(message, pending);
            }).then(ended, (error: unknown) => {
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

  const ask = (request: Record<string, unknown>) =>
    new Promise<Reply>((resolve, reject) => {
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

  return {
    clearBrowsingData: async (request) => {
      const reply = await ask({ ...request, type: "clear_browsing_data" });
      if (reply.type !== "cleared") {
        throw unexpected(reply, "cleared");
      }
    },
    deleteHistory: async (visits) => {
      const reply = await ask({ type: "delete_history", visits });
      if (reply.type !== "deleted") {
        throw unexpected(reply, "deleted");
      }
    },
    history: async ({ endTime, maxResults, text }) => {
      const reply = await ask({
        end_time: endTime,
        max_results: maxResults,
        text,
        type: "history",
      });
      if (reply.type === "history") {
        return reply.items;
      } else {
        throw unexpected(reply, "history");
      }
    },
    openUrl: async (url) => {
      const reply = await ask({ type: "open_url", url });
      if (reply.type !== "opened") {
        throw unexpected(reply, "opened");
      }
    },
    visits: async (url) => {
      const reply = await ask({ type: "visits", url });
      if (reply.type === "visits") {
        return reply.times;
      } else {
        throw unexpected(reply, "visits");
      }
    },
  };
};

/** A request waiting for its reply. */
type Pending = {
  reject: (error: Error) => void;
  resolve: (reply: Reply) => void;
};

const itemSchema = z
  .object({
    favicon: z.string().nullable(),
    title: z.string(),
    url: z.string(),
  })
  .transform(
    ({ favicon, title, url }): HistoryItem => ({
      favicon: favicon ?? undefined,
      title,
      url,
    }),
  );

const replySchema = z.discriminatedUnion("type", [
  z.object({
    id: z.number(),
    items: z.array(itemSchema),
    type: z.literal("history"),
  }),
  z.object({
    id: z.number(),
    times: z.array(z.number()),
    type: z.literal("visits"),
  }),
  z.object({ id: z.number(), type: z.literal("deleted") }),
  z.object({ id: z.number(), type: z.literal("cleared") }),
  z.object({ id: z.number(), type: z.literal("opened") }),
  z.object({ id: z.number(), type: z.literal("refused"), why: z.string() }),
]);

type Reply = z.output<typeof replySchema>;

/** Settles the request `message` answers. */
const received = (message: unknown, pending: Map<number, Pending>) => {
  const reply = replySchema.parse(message);
  const waiting = pending.get(reply.id);
  if (waiting === undefined) {
    throw new Error(`The app host answered ${reply.id}, never asked`);
  } else {
    pending.delete(reply.id);
    if (reply.type === "refused") {
      waiting.reject(new Error(reply.why));
    } else {
      waiting.resolve(reply);
    }
  }
};

/** The error for a reply of the wrong type. */
const unexpected = (reply: Reply, wanted: Reply["type"]) =>
  new Error(`The app host answered ${reply.type}, not ${wanted}`);

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
