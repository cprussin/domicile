// The engine's end of the Electron socket: one connection for this app, JSON
// lines both ways. See electron_protocol.h in the engine.

import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";
import type { MenuEntry } from "./electron/menu";
import type { ShowMessageBoxMessage } from "./electron/message-boxes";
import type { PortRequest } from "./electron/message-port-main";
import type {
  IncomingPermissionRequest,
  PermissionMessage,
} from "./electron/permissions";
import type { IncomingRequest, ProtocolRequest } from "./electron/protocol";
import type { RegisteredScheme } from "./electron/schemes";
import type {
  SessionCallMessage,
  SessionResult,
} from "./electron/session-calls";
import type {
  IncomingWebRequest,
  WebRequestMessage,
} from "./electron/web-request";

export const PROTOCOL_VERSION = 1;

/** Where the app asks for one of a window's views, in its page's CSS pixels. */
export type ViewPlacement = {
  readonly window: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly hidden?: true;
};

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
      /** Its session's Electron partition; the app's own when left out. */
      readonly session?: string;
      /** A view (`WebContentsView`), shown only as part of a window. */
      readonly view?: true;
    }
  | {
      readonly type: "set_views";
      readonly window: number;
      /** The window's views, bottom first, replacing those it held. */
      readonly views: readonly ViewPlacement[];
    }
  | { readonly type: "load_url"; readonly window: number; readonly url: string }
  | { readonly type: "focus_window"; readonly window: number }
  | { readonly type: "close_window"; readonly window: number }
  | { readonly type: "destroy_window"; readonly window: number }
  | {
      readonly type: "set_menu_bar";
      readonly window: number;
      /** The menu as the menu bar draws it, or none for no menu bar. */
      readonly menu: readonly MenuEntry[] | null;
      readonly visible: boolean;
      /** Hidden until the user presses Alt. */
      readonly auto_hide: boolean;
    }
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
    }
  | {
      readonly type: "ipc_post";
      readonly window: number;
      readonly channel: string;
      readonly message: unknown;
      /** The names of the app's ports that go with it, each "m" and a number. */
      readonly ports: string[];
    }
  | ShowMessageBoxMessage
  | PortRequest
  | ProtocolRequest
  | WebRequestMessage
  | SessionCallMessage
  | PermissionMessage;

const engineEvent = z.discriminatedUnion("type", [
  z.object({
    schemes: z.array(
      z.object({ privileges: z.array(z.string()), scheme: z.string() }),
    ),
    type: z.literal("ready"),
  }),
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
  z.object({
    args: z.array(z.unknown()),
    channel: z.string(),
    invoke: z.number(),
    type: z.literal("ipc_send_sync"),
    window: z.number(),
  }),
  z.object({
    channel: z.string(),
    message: z.unknown(),
    ports: z.array(z.string()),
    type: z.literal("ipc_post"),
    window: z.number(),
  }),
  z.object({
    data: z.unknown(),
    port: z.string(),
    type: z.literal("port_message"),
    window: z.number(),
  }),
  z.object({
    port: z.string(),
    type: z.literal("port_closed"),
    window: z.number(),
  }),
  z.object({ type: z.literal("page_gone"), window: z.number() }),
  /** The size the shell gives a page, a window's or a view's. */
  z.object({
    height: z.number(),
    type: z.literal("resized"),
    width: z.number(),
    window: z.number(),
  }),
  z.object({
    command: z.number(),
    type: z.literal("menu_clicked"),
    window: z.number(),
  }),
  z.object({
    box: z.number(),
    checkbox_checked: z.boolean(),
    response: z.number(),
    type: z.literal("message_box_answered"),
    window: z.number(),
  }),
  z.object({
    body: z.string().optional(),
    headers: z.array(z.tuple([z.string(), z.string()])),
    method: z.string(),
    request: z.number(),
    session: z.string(),
    type: z.literal("protocol_request"),
    url: z.string(),
  }),
  z.object({
    ask: z.number().optional(),
    error: z.string().optional(),
    event: z.enum([
      "before_request",
      "before_send_headers",
      "send_headers",
      "headers_received",
      "response_started",
      "before_redirect",
      "completed",
      "error_occurred",
    ]),
    from_cache: z.boolean().optional(),
    id: z.number(),
    ip: z.string().optional(),
    method: z.string(),
    redirect_url: z.string().optional(),
    referrer: z.string(),
    request_headers: z.array(z.tuple([z.string(), z.string()])).optional(),
    resource_type: z.string(),
    response_headers: z.array(z.tuple([z.string(), z.string()])).optional(),
    session: z.string(),
    status_code: z.number().optional(),
    status_line: z.string().optional(),
    type: z.literal("web_request"),
    url: z.string(),
    window: z.number().optional(),
  }),
  z.object({
    call: z.number(),
    error: z.string().optional(),
    result: z.unknown().optional(),
    type: z.literal("session_result"),
  }),
  z.object({
    ask: z.number(),
    media_types: z.array(z.string()).optional(),
    permission: z.string(),
    requesting_url: z.string(),
    session: z.string(),
    type: z.literal("permission_request"),
    window: z.number().optional(),
  }),
]);

export type EngineEvent = z.infer<typeof engineEvent>;

/** What the engine says about one window. */
export type WindowEvent = Extract<EngineEvent, { window: number }>;

export type Engine = {
  readonly send: (request: EngineRequest) => void;
  /**
   * The apps' own schemes the engine registered as it started, with the
   * privileges it granted each, by Electron's names.
   */
  readonly schemes: readonly RegisteredScheme[];
  /**
   * `window` for each window event, `refused` for a request the engine could
   * not take, and `lost` once the connection ends.
   */
  readonly events: EventEmitter<{
    lost: [why: string];
    refused: [why: string];
    window: [event: WindowEvent];
    /** A page's request that its session's protocol handler answers. */
    protocol: [request: IncomingRequest];
    /** An event of a page's request, for its session's webRequest. */
    webRequest: [request: IncomingWebRequest];
    /** The engine's answer to a session call. */
    sessionResult: [result: SessionResult];
    /** A page's permission request, for its session's handler. */
    permissionRequest: [request: IncomingPermissionRequest];
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

    const engine: Omit<Engine, "schemes"> = {
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
            ? Ok({ ...engine, schemes: parsed.data.schemes })
            : Err(
                `the engine refused this app: ${"why" in parsed.data ? parsed.data.why : parsed.data.type}`,
              ),
        );
      } else if (parsed.data.type === "refused") {
        events.emit("refused", parsed.data.why);
      } else if (parsed.data.type === "protocol_request") {
        events.emit("protocol", parsed.data);
      } else if (parsed.data.type === "web_request") {
        events.emit("webRequest", parsed.data);
      } else if (parsed.data.type === "session_result") {
        const { call, error, result } = parsed.data;
        events.emit(
          "sessionResult",
          error === undefined
            ? { call, result, type: "session_result" }
            : { call, error, type: "session_result" },
        );
      } else if (parsed.data.type === "permission_request") {
        events.emit("permissionRequest", parsed.data);
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

/**
 * The engine at `path`, once it's up: the desktop starts its apps as it
 * comes up, before the engine may be listening, so a socket that isn't there
 * or isn't answering yet is tried again until `wait` milliseconds have passed.
 * Any other failure, or one that outlasts the wait, is the answer.
 */
export const connectEngineWhenUp = async (
  connect: () => Promise<Result<Engine, string>>,
  wait: number,
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<Result<Engine, string>> => {
  const started = Date.now();
  for (;;) {
    const result = await connect();
    const notUpYet = result.match({
      Err: (why) =>
        why.startsWith("can't reach the engine") &&
        /ENOENT|ECONNREFUSED/.test(why),
      Ok: () => false,
    });
    if (!notUpYet) {
      return result;
    }
    if (Date.now() - started >= wait) {
      return result.match({
        Err: (why) =>
          Err(
            `${why}, and it still wasn't up after ${Math.round(wait / 1000)}s`,
          ),
        Ok: (engine) => Ok(engine),
      });
    }
    await sleep(250);
  }
};
