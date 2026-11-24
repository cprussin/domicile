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
import type { PageMethod } from "./electron/page-control";
import type {
  IncomingPermissionRequest,
  PermissionMessage,
} from "./electron/permissions";
import type { IncomingRequest, ProtocolRequest } from "./electron/protocol";
import type { RegisteredScheme } from "./electron/schemes";
import type {
  CookieChanged,
  SessionCallMessage,
  SessionResult,
} from "./electron/session-calls";
import type {
  IncomingWebRequest,
  WebRequestMessage,
} from "./electron/web-request";

export const PROTOCOL_VERSION = 1;

/** What a page with Node.js needs: Electron's renderer's own settings. */
export type PageNode = {
  /** The preload's file, for Node's require; left out for none. */
  readonly preload?: string;
  /** `nodeIntegration`: Node in the page's own world too, without isolation. */
  readonly integration: boolean;
  readonly context_isolation: boolean;
  readonly app_path: string;
  /** The app's environment, which the page's `process.env` has. */
  readonly env: Readonly<Record<string, string>>;
};

/** Where the app asks for one of a window's views, in its page's CSS pixels. */
export type ViewPlacement = {
  readonly window: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly hidden?: true;
};

/** What `open_window` and an allowing `window_open_answer` say of a page. */
export type OpenKeys = {
  readonly window: number;
  /** The preload's source, run before each page's own scripts. */
  readonly preload?: string;
  /** webPreferences.additionalArguments, in the page's process.argv. */
  readonly arguments?: readonly string[];
  /** Its session's Electron partition; the app's own when left out. */
  readonly session?: string;
  /** A view (`WebContentsView`), shown only as part of a window. */
  readonly view?: true;
  /** A window's own title, which the desktop shows over its page's. */
  readonly title?: string;
  /** A window that opens hidden, as `show: false`. */
  readonly hidden?: true;
  /**
   * Node.js in the page of a window that isn't sandboxed. Its preload is
   * a file Node loads, so `preload` is left out.
   */
  readonly node?: PageNode;
};

/** What an app says of itself as it connects, which its pages are told. */
export type EngineHello = {
  readonly app_id: string;
  readonly partition: string;
  /** `process.versions.electron` in its pages. */
  readonly electron_version: string;
  /** `process.resourcesPath` in its pages. */
  readonly resources_path: string;
};

/** What the engine's `edit` does, by its names on the wire. */
export type EditCommand =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "paste_and_match_style"
  | "delete"
  | "select_all"
  | "unselect"
  | "center_selection";

export type EngineRequest =
  | ({ readonly type: "hello"; readonly version: number } & EngineHello)
  | ({ readonly type: "open_window"; readonly url: string } & OpenKeys)
  /** The app's answer to a page's `window_open`: its handler denied it. */
  | {
      readonly type: "window_open_answer";
      readonly ask: number;
      readonly action: "deny";
    }
  /** Or allowed it: the window opens where the page asked. */
  | ({
      readonly type: "window_open_answer";
      readonly ask: number;
      readonly action: "allow";
    } & OpenKeys)
  | {
      readonly type: "set_views";
      readonly window: number;
      /** The window's views, bottom first, replacing those it held. */
      readonly views: readonly ViewPlacement[];
    }
  | { readonly type: "load_url"; readonly window: number; readonly url: string }
  | { readonly type: "focus_window"; readonly window: number }
  | {
      readonly type: "go_to_index";
      readonly window: number;
      readonly index: number;
    }
  | { readonly type: "clear_history"; readonly window: number }
  /** webContents.undo and the rest of the Edit menu, at the page's focus. */
  | {
      readonly type: "edit";
      readonly window: number;
      readonly command: EditCommand;
    }
  /** webContents.replace, or replaceMisspelling. */
  | {
      readonly type: "replace";
      readonly window: number;
      readonly text: string;
      readonly misspelling: boolean;
    }
  /** webContents.findInPage, which the app numbers from 1. */
  | {
      readonly type: "find_in_page";
      readonly window: number;
      readonly request: number;
      readonly text: string;
      readonly forward: boolean;
      readonly find_next: boolean;
      readonly match_case: boolean;
    }
  | {
      readonly type: "stop_find_in_page";
      readonly window: number;
      readonly action:
        | "clear_selection"
        | "keep_selection"
        | "activate_selection";
    }
  | {
      readonly type: "set_title";
      readonly window: number;
      readonly title: string;
    }
  | {
      readonly type: "set_hidden";
      readonly window: number;
      readonly hidden: boolean;
    }
  | {
      /** app.userAgentFallback: each session's pages' unless it has its own. */
      readonly type: "set_user_agent_fallback";
      readonly user_agent: string;
    }
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
      /**
       * `maximize`, `minimize`, `setFullScreen` and their undoing: what the
       * app asks the shell to make the window. The shell decides, and says
       * what it did with `window_state`.
       */
      readonly type: "set_window_state";
      readonly window: number;
      readonly maximized: boolean;
      readonly minimized: boolean;
      readonly fullscreen: boolean;
    }
  | {
      /** `Menu.popup`: the shell draws `menu` over the window. */
      readonly type: "popup_menu";
      readonly window: number;
      /** Names this popup in its `popup_menu_closed`. */
      readonly popup: number;
      readonly menu: readonly MenuEntry[];
      /** Where, in CSS pixels from the page's top left; else the last press. */
      readonly x?: number;
      readonly y?: number;
    }
  | {
      /** `Menu.closePopup`: puts popup `popup` away, if it is still up. */
      readonly type: "close_popup_menu";
      readonly window: number;
      readonly popup: number;
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
  | {
      readonly type: "execute_javascript";
      readonly window: number;
      readonly call: number;
      readonly code: string;
      readonly user_gesture?: true;
    }
  /** A webContents member the engine carries out, answered by `page_result`. */
  | ({
      readonly type: "page_call";
      readonly window: number;
      readonly call: number;
    } & PageMethod)
  | ShowMessageBoxMessage
  | PortRequest
  | ProtocolRequest
  | WebRequestMessage
  | SessionCallMessage
  | PermissionMessage;

const engineEvent = z.discriminatedUnion("type", [
  z.object({
    chrome_version: z.string(),
    schemes: z.array(
      z.object({ privileges: z.array(z.string()), scheme: z.string() }),
    ),
    type: z.literal("ready"),
    user_agent: z.string(),
  }),
  z.object({ type: z.literal("refused"), why: z.string() }),
  z.object({ type: z.literal("window_opened"), window: z.number() }),
  /** The page asked for a window: setWindowOpenHandler decides. */
  z.object({
    ask: z.number(),
    disposition: z.string(),
    features: z.string(),
    frame_name: z.string(),
    referrer: z.string(),
    type: z.literal("window_open"),
    url: z.string(),
    window: z.number(),
  }),
  z.object({
    type: z.literal("window_refused"),
    why: z.string(),
    window: z.number(),
  }),
  // The page's DOM is ready: Electron's dom-ready.
  z.object({ type: z.literal("window_dom_ready"), window: z.number() }),
  z.object({ type: z.literal("window_loaded"), window: z.number() }),
  z.object({
    title: z.string(),
    type: z.literal("title_changed"),
    window: z.number(),
  }),
  z.object({ type: z.literal("window_closed"), window: z.number() }),
  // The user asked to close the window: the app's `close` listeners decide.
  z.object({ type: z.literal("close_asked"), window: z.number() }),
  // What the page is now, each time any of it changes.
  z.object({
    crashed: z.boolean(),
    entries: z.array(z.object({ title: z.string(), url: z.string() })),
    focused: z.boolean(),
    /** The main frame's token, as webFrameMain.fromFrameToken takes it. */
    frame_token: z.string(),
    index: z.number(),
    loading: z.boolean(),
    pid: z.number(),
    /** Chromium's number for the renderer, as getProcessId gives it. */
    process_id: z.number(),
    /** The main frame's number in its renderer. */
    routing_id: z.number(),
    type: z.literal("page_state"),
    /** Whether the page waits for its main resource's response. */
    waiting: z.boolean(),
    window: z.number(),
  }),
  // A find_in_page search's last answer.
  z.object({
    active_match_ordinal: z.number(),
    matches: z.number(),
    request: z.number(),
    selection: z.object({
      height: z.number(),
      width: z.number(),
      x: z.number(),
      y: z.number(),
    }),
    type: z.literal("found_in_page"),
    window: z.number(),
  }),
  // A context menu the user asked for over a page: Electron's context-menu.
  z.object({
    alt_text: z.string(),
    dictionary_suggestions: z.array(z.string()),
    edit_flags: z.object({
      can_copy: z.boolean(),
      can_cut: z.boolean(),
      can_delete: z.boolean(),
      can_edit_richly: z.boolean(),
      can_paste: z.boolean(),
      can_redo: z.boolean(),
      can_select_all: z.boolean(),
      can_undo: z.boolean(),
    }),
    frame_charset: z.string(),
    frame_url: z.string(),
    has_image_contents: z.boolean(),
    is_editable: z.boolean(),
    link_text: z.string(),
    link_url: z.string(),
    media_flags: z.object({
      can_loop: z.boolean(),
      can_print: z.boolean(),
      can_rotate: z.boolean(),
      can_save: z.boolean(),
      can_show_picture_in_picture: z.boolean(),
      can_toggle_controls: z.boolean(),
      has_audio: z.boolean(),
      in_error: z.boolean(),
      is_controls_visible: z.boolean(),
      is_looping: z.boolean(),
      is_muted: z.boolean(),
      is_paused: z.boolean(),
      is_showing_picture_in_picture: z.boolean(),
    }),
    media_type: z.enum([
      "none",
      "image",
      "audio",
      "video",
      "canvas",
      "file",
      "plugin",
    ]),
    misspelled_word: z.string(),
    page_url: z.string(),
    selection_text: z.string(),
    spellcheck_enabled: z.boolean(),
    src_url: z.string(),
    suggested_filename: z.string(),
    title_text: z.string(),
    type: z.literal("context_menu"),
    window: z.number(),
    x: z.number(),
    y: z.number(),
  }),
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
  /** What the app's executeJavaScript `call` gave, or why it gave nothing. */
  z.object({
    call: z.number(),
    error: z.string().optional(),
    result: z.unknown().optional(),
    type: z.literal("javascript_result"),
    window: z.number(),
  }),
  /** What a `page_call` gave, or why it gave nothing. */
  z.object({
    call: z.number(),
    error: z.string().optional(),
    result: z.unknown().optional(),
    type: z.literal("page_result"),
    window: z.number(),
  }),
  /** An event of the page's DevTools client, which page calls drive. */
  z.object({
    method: z.string(),
    params: z.record(z.string(), z.unknown()),
    type: z.literal("devtools_event"),
    window: z.number(),
  }),
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
  // What the shell made the window, each time that changes.
  z.object({
    fullscreen: z.boolean(),
    maximized: z.boolean(),
    minimized: z.boolean(),
    type: z.literal("window_state"),
    window: z.number(),
  }),
  // A popup menu closed: `command` is the entry chosen, or 0 for none.
  z.object({
    command: z.number(),
    popup: z.number(),
    type: z.literal("popup_menu_closed"),
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
    cause: z.string(),
    cookie: z.object({
      domain: z.string(),
      expirationDate: z.number().exactOptional(),
      hostOnly: z.boolean(),
      httpOnly: z.boolean(),
      name: z.string(),
      path: z.string(),
      sameSite: z.string(),
      secure: z.boolean(),
      session: z.boolean(),
      value: z.string(),
    }),
    removed: z.boolean(),
    session: z.string(),
    type: z.literal("cookie_changed"),
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

/** What the engine last said of a page: its history, loading and focus. */
export type PageState = Omit<
  Extract<EngineEvent, { type: "page_state" }>,
  "type" | "window"
>;

/** The engine's own user agent and Chrome's full version, from its `ready`. */
export type EngineBrowser = {
  readonly userAgent: string;
  readonly chromeVersion: string;
};

export type Engine = {
  readonly send: (request: EngineRequest) => void;
  readonly browser: EngineBrowser;
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
    /** A change to the cookies of a session the app watches. */
    cookieChanged: [change: CookieChanged];
    /** A page's permission request, for its session's handler. */
    permissionRequest: [request: IncomingPermissionRequest];
  }>;
};

/**
 * Connects to the engine at `path` and says `hello`: the app's id, the
 * partition its pages keep their data in, and what its pages are told of their
 * Electron. Ready once the engine answers.
 */
export const connectEngine = (
  path: string,
  hello: EngineHello,
): Promise<Result<Engine, string>> =>
  new Promise((resolve) => {
    const socket = createConnection(path);
    const events: Engine["events"] = new EventEmitter();
    let ready = false;
    let pending = "";

    const engine: Omit<Engine, "schemes" | "browser"> = {
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
            ? Ok({
                ...engine,
                browser: {
                  chromeVersion: parsed.data.chrome_version,
                  userAgent: parsed.data.user_agent,
                },
                schemes: parsed.data.schemes,
              })
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
      } else if (parsed.data.type === "cookie_changed") {
        events.emit("cookieChanged", parsed.data);
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
    engine.send({ ...hello, type: "hello", version: PROTOCOL_VERSION });
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
