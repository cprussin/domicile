// `domicile-app-host`, the process the app runs, as History uses it: the
// browser's history, its browsing data and its windows. Every reply is parsed.
// The protocol is `domicile_launch::app_host`'s.

import { spawnedAppHost } from "@domicile-desktop/app-host-client";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import { z } from "zod";

import type { HistoryItem, PageQuery } from "./history-page";

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
  const { ask } = spawnedAppHost({ processes, replies: replySchema });

  return {
    clearBrowsingData: async (request) => {
      await ask({ ...request, type: "clear_browsing_data" }, "cleared");
    },
    deleteHistory: async (visits) => {
      await ask({ type: "delete_history", visits }, "deleted");
    },
    history: async ({ endTime, maxResults, text }) => {
      const reply = await ask(
        {
          end_time: endTime,
          max_results: maxResults,
          text,
          type: "history",
        },
        "history",
      );
      return reply.items;
    },
    openUrl: async (url) => {
      await ask({ type: "open_url", url }, "opened");
    },
    visits: async (url) => {
      const reply = await ask({ type: "visits", url }, "visits");
      return reply.times;
    },
  };
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
]);
