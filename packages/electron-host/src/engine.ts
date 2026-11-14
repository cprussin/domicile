// The engine's end of the Electron socket: one connection for this app, JSON
// lines both ways. See electron_protocol.h in the engine.

import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export type EngineRequest =
  | {
      readonly type: "hello";
      readonly version: number;
      readonly app_id: string;
      readonly partition: string;
    }
  | {
      readonly type: "open_window";
      readonly window: number;
      readonly url: string;
      /** The preload's source, run before each page's own scripts. */
      readonly preload?: string;
    }
  | { readonly type: "load_url"; readonly window: number; readonly url: string }
  | { readonly type: "focus_window"; readonly window: number }
  | { readonly type: "close_window"; readonly window: number }
  | { readonly type: "destroy_window"; readonly window: number }
  | {
      readonly type: "ipc_send";
      readonly window: number;
      readonly channel: string;
      readonly args: unknown[];
    }
  | {
      readonly type: "ipc_reply";
      readonly invoke: number;
      readonly result: unknown;
    }
  | {
      readonly type: "ipc_reply";
      readonly invoke: number;
      readonly error: string;
    };

const engineEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("refused"), why: z.string() }),
  z.object({ type: z.literal("window_opened"), window: z.number() }),
  z.object({
    type: z.literal("window_refused"),
    why: z.string(),
    window: z.number(),
  }),
  z.object({ type: z.literal("window_loaded"), window: z.number() }),
  z.object({
    title: z.string(),
    type: z.literal("title_changed"),
    window: z.number(),
  }),
  z.object({ type: z.literal("window_closed"), window: z.number() }),
  z.object({
    args: z.array(z.unknown()),
    channel: z.string(),
    type: z.literal("ipc_message"),
    window: z.number(),
  }),
  z.object({
    args: z.array(z.unknown()),
    channel: z.string(),
    invoke: z.number(),
    type: z.literal("ipc_invoke"),
    window: z.number(),
  }),
]);

export type EngineEvent = z.infer<typeof engineEvent>;

/** What the engine says about one window. */
export type WindowEvent = Extract<EngineEvent, { window: number }>;

export type Engine = {
  readonly send: (request: EngineRequest) => void;
  /**
   * `window` for each window event, `refused` for a request the engine could
   * not take, and `lost` once the connection ends.
   */
  readonly events: EventEmitter<{
    lost: [why: string];
    refused: [why: string];
    window: [event: WindowEvent];
  }>;
};

/**
 * Connects to the engine at `path` and says hello for `appId`, whose pages
 * keep their data in `partition`. Ready once the engine answers.
 */
export const connectEngine = (
  path: string,
  appId: string,
  partition: string,
): Promise<Result<Engine, string>> =>
  new Promise((resolve) => {
    const socket = createConnection(path);
    const events: Engine["events"] = new EventEmitter();
    let ready = false;
    let pending = "";

    const engine: Engine = {
      events,
      send: (request) => {
        socket.write(`${JSON.stringify(request)}\n`);
      },
    };

    const take = (line: string) => {
      const parsed = engineEvent.safeParse(parseJson(line));
      if (!parsed.success) {
        throw new Error(`the engine sent a line this host can't read: ${line}`);
      } else if (!ready) {
        ready = true;
        resolve(
          parsed.data.type === "ready"
            ? Ok(engine)
            : Err(
                `the engine refused this app: ${"why" in parsed.data ? parsed.data.why : parsed.data.type}`,
              ),
        );
      } else if (parsed.data.type === "refused") {
        events.emit("refused", parsed.data.why);
      } else if ("window" in parsed.data) {
        events.emit("window", parsed.data);
      } else {
        throw new Error(`the engine said ${line} after this app's hello`);
      }
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        take(line);
      }
    });
    socket.on("error", (error) => {
      if (ready) {
        events.emit("lost", error.message);
      } else {
        ready = true;
        resolve(Err(`can't reach the engine at ${path}: ${error.message}`));
      }
    });
    socket.on("close", () => {
      if (ready) {
        events.emit("lost", "the engine closed this app's connection");
      } else {
        ready = true;
        resolve(Err(`the engine at ${path} closed before answering`));
      }
    });
    engine.send({
      app_id: appId,
      partition,
      type: "hello",
      version: PROTOCOL_VERSION,
    });
  });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    } else {
      throw error;
    }
  }
};
