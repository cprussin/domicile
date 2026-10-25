// Files, watches and processes for a shell: the compositor's system calls,
// typed. See docs/SHELL-SYSTEM-ACCESS.md.
//
// Each call goes out through `callSystem` with an id, and its answers come
// back as `system` events carrying that id. A call that can fail resolves a
// `Result`; a bug in the protocol throws.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

import type { DomicileHost } from "./domicile-host";
import type { KeymapChoice, Keymaps } from "./keymap-choice";
import { wireKeymapChoice } from "./keymap-choice";
import type { PreviewedWindow } from "./previewed-window";
import { PreviewedWindowKind } from "./previewed-window";
import type {
  SystemEndMessage,
  SystemEventMessage,
  SystemReplyMessage,
} from "./system-message";
import { parseSystemMessage } from "./system-message";
import type { WindowState } from "./window-state";
import { WindowRequest, wireWindowState } from "./window-state";

/** Why a system call failed, as the compositor said. */
export enum SystemErrorKind {
  NotFound,
  PermissionDenied,
  AlreadyExists,
  NotADirectory,
  IsADirectory,
  /** Bad data, an empty argv, or an id already running: a bug in the caller. */
  InvalidInput,
  /** The desktop is locked. See docs/LOCK.md. */
  Locked,
  /** A D-Bus method returned an error; the message starts with its name. */
  Dbus,
  /** The user dismissed the dialog the call put up. */
  Canceled,
  /**
   * The compositor exited with the call open. A watch or other {@link
   * Listening} never ends this way: it listens again under the next
   * compositor. See "A compositor restart" in docs/architecture/ENGINE-FORK.md.
   */
  CompositorGone,
  Other,
}

/** Why the lock did not take a passphrase. See docs/LOCK.md. */
export enum UnlockRefusal {
  /** The compositor checked it, and it is wrong. */
  WrongPassphrase,
  /** The compositor could not check it, such as a PAM module missing. */
  Unverifiable,
  /** Sent during the wait after repeated refused passphrases, so not checked. */
  TooSoon,
}

/** A passphrase the lock did not take. */
export type UnlockRefused = {
  refusal: UnlockRefusal;
  /** Refused passphrases, wrong or unverifiable, since the desktop last opened. */
  failures: number;
  /** How long the compositor refuses every passphrase, unchecked. */
  retryInMs: number;
};

export type SystemError = {
  kind: SystemErrorKind;
  /** The operating system's description, for logs. */
  message: string;
};

export enum FileType {
  File,
  Directory,
  Symlink,
  /** A device, socket or pipe. */
  Other,
}

export type DirEntry = {
  name: string;
  /** The entry's own type: a symlink is not followed. */
  fileType: FileType;
};

export type Stat = {
  /** What the path is, following symlinks. */
  fileType: FileType;
  /** In bytes. Files under `/sys` and `/proc` report 0 or 4096. */
  size: number;
  modifiedMs: number | undefined;
};

export enum Signal {
  Hup,
  Int,
  Term,
  Kill,
  Usr1,
  Usr2,
}

export type SpawnOptions = {
  /** Where it runs; the home by default. Relative paths start at the home. */
  cwd?: string;
  /** Added to the desktop's environment. */
  env?: Readonly<Record<string, string>>;
  /** Whether {@link Subprocess.write} can reach it; `/dev/null` otherwise. */
  stdin?: boolean;
};

/** How a process ended: its exit code, or the signal that killed it. */
export type Exit = {
  code: number | undefined;
  signal: number | undefined;
};

export type Subprocess = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  /** Settles after all of its output. */
  exited: Promise<Result<Exit, SystemError>>;
  write: (data: Uint8Array | string) => void;
  closeStdin: () => void;
  /** Signals its process group: {@link Signal.Term} by default. */
  kill: (signal?: Signal) => void;
};

export enum Bus {
  Session,
  System,
}

/**
 * A D-Bus method call. `body` holds one JSON value per complete type in
 * `signature`, written as `domicile_host::dbus_json` describes: `v` is
 * `{ signature, value }`, `a{KV}` an object, structures and arrays arrays.
 */
export type DbusCall = {
  bus: Bus;
  destination: string;
  path: string;
  interface: string;
  member: string;
  /** Empty, the default, for no arguments. */
  signature?: string;
  body?: readonly unknown[];
};

/** A D-Bus body: what a method returned, or a signal carried. */
export type DbusBody = {
  signature: string;
  /** Untyped: parse it with a schema for the signature you expect. */
  body: unknown[];
};

/** The signals to report: those matching every field given. */
export type DbusMatch = {
  bus: Bus;
  sender?: string;
  path?: string;
  interface?: string;
  member?: string;
};

export type DbusSignal = DbusBody & {
  sender: string;
  path: string;
  interface: string;
  member: string;
};

export type Listening<T> = {
  /** Closes when it ends. */
  items: ReadableStream<T>;
  stop: () => void;
  /** `Ok` after {@link Listening.stop}, `Err` if it broke. */
  ended: Promise<Result<"stopped", SystemError>>;
};

/** What a watch or a D-Bus match heard. */
export enum ListenedKind {
  /** A change or a signal. */
  Heard,
  /**
   * The compositor restarted, and the call was sent again for the next one.
   * Changes in between were not heard: read again what the items told you.
   */
  Missed,
}

export const Listened = {
  Heard: <T>(item: T) => ({ item, kind: ListenedKind.Heard as const }),
  Missed: () => ({ kind: ListenedKind.Missed as const }),
};

export type Listened<T> =
  | ReturnType<typeof Listened.Heard<T>>
  | ReturnType<typeof Listened.Missed>;

/** Part of a file: from `offset` (0 by default), `length` bytes or to the end. */
export type ByteRange = {
  offset?: number;
  length?: number;
};

/** What {@link System.run} collected. */
export type Ran = Exit & { stdout: string; stderr: string };

/** Where a screenshot from the shell's dialog went. */
export enum ScreenshotKeptKind {
  /** Saved under `$XDG_PICTURES_DIR/Screenshots/`. */
  Saved,
  /** Copied to the clipboard with Ctrl+C, and not saved. */
  Copied,
}

export const ScreenshotKept = {
  Copied: () => ({ kind: ScreenshotKeptKind.Copied as const }),
  /** Saved as the PNG at `path`. */
  Saved: (path: string) => ({ kind: ScreenshotKeptKind.Saved as const, path }),
};

export type ScreenshotKept = ReturnType<
  (typeof ScreenshotKept)[keyof typeof ScreenshotKept]
>;

/** A watch's `items` hear the absolute path of each change. */
export type Watch = Listening<Listened<string>>;

/** A monitor for {@link System.addVirtualMonitor} to add. */
export type VirtualMonitorMode = {
  /** Its description, such as the TV it is cast to. */
  name: string;
  width: number;
  height: number;
  refreshMhz: number;
};

/** A monitor with no connector, which the desk extends onto. */
export type VirtualMonitor = {
  /** Its `wl_output` name, as `domicile.displays` names it. */
  output: string;
  remove: () => void;
  /**
   * `Ok` after {@link VirtualMonitor.remove}. `Err` when it went with its
   * compositor; the next one does not have it.
   */
  ended: Promise<Result<"removed", SystemError>>;
};

/**
 * The calls. A relative path starts at the home. The compositor runs each in
 * the desktop's environment and refuses most of them while the desktop is
 * locked.
 */
export type System = {
  /** The whole file, or `length` bytes from `offset`: fewer at its end. */
  readFile: (
    path: string,
    range?: ByteRange,
  ) => Promise<Result<Uint8Array, SystemError>>;
  readTextFile: (path: string) => Promise<Result<string, SystemError>>;
  /** Atomic by default: a reader never sees half a file. Writes under `/sys` and `/proc` must not be. */
  writeFile: (
    path: string,
    data: Uint8Array | string,
    options?: { atomic?: boolean },
  ) => Promise<Result<"written", SystemError>>;
  /** Fails {@link SystemErrorKind.AlreadyExists} if anything has the name. */
  createDir: (path: string) => Promise<Result<"created", SystemError>>;
  readDir: (path: string) => Promise<Result<DirEntry[], SystemError>>;
  stat: (path: string) => Promise<Result<Stat, SystemError>>;
  watch: (path: string) => Promise<Result<Watch, SystemError>>;
  /** Run `argv` directly, with no shell; `argv[0]` is looked up on `PATH`. */
  spawn: (
    argv: readonly string[],
    options?: SpawnOptions,
  ) => Promise<Result<Subprocess, SystemError>>;
  /** {@link System.spawn}, collected as text once it ends. */
  run: (
    argv: readonly string[],
    options?: Omit<SpawnOptions, "stdin">,
  ) => Promise<Result<Ran, SystemError>>;
  dbusCall: (call: DbusCall) => Promise<Result<DbusBody, SystemError>>;
  dbusMatch: (
    match: DbusMatch,
  ) => Promise<Result<Listening<Listened<DbusSignal>>, SystemError>>;
  /**
   * Take a screenshot as an interactive Screenshot portal call takes one, as
   * if the shell were the application: the desk freezes, `<PortalDialogs />`
   * draws the screenshot dialog, and the area picked is saved under
   * `$XDG_PICTURES_DIR/Screenshots/`, or copied to the clipboard instead when
   * the user presses Ctrl+C. Resolves with where it went.
   */
  screenshot: () => Promise<Result<ScreenshotKept, SystemError>>;
  /**
   * Draw `window` as it last drew itself, as a `data:` URL of a PNG, for a
   * picker to preview a window that is not on screen. A browser window's page
   * draws while it is captured, so a hidden one draws too.
   */
  previewWindow: (
    window: PreviewedWindow,
  ) => Promise<Result<string, SystemError>>;
  /**
   * Hear each command `domicile send-shell` sends, as its words. Every page
   * listening hears every command. Allowed while the desktop is locked.
   */
  shellCommands: () => Promise<
    Result<Listening<readonly string[]>, SystemError>
  >;
  /**
   * Hear the milliseconds left before the screens blank when
   * `idle.warn_before_seconds` passes, and `undefined` when input or an idle
   * inhibitor calls it off or the screens go dark. A page that listens during
   * a warning hears it at once. Allowed while the desktop is locked. See
   * docs/SHELL-IDLE-AND-LOCK.md.
   */
  idleWarnings: () => Promise<
    Result<Listening<number | undefined>, SystemError>
  >;
  /**
   * Hear why each passphrase sent with `unlock` did not open the desk. Every
   * page listening hears every refusal. Allowed while the desktop is locked.
   */
  unlockRefusals: () => Promise<Result<Listening<UnlockRefused>, SystemError>>;
  /**
   * Replace the `xdg_toplevel` states the shell set on window `appId`, and
   * configure it. States last until the shell replaces them, across reloads.
   * Fails {@link SystemErrorKind.NotFound} for a window the compositor does
   * not know. Allowed while the desktop is locked.
   */
  setWindowStates: (
    appId: string,
    states: readonly WindowState[],
  ) => Promise<Result<"set", SystemError>>;
  /**
   * Hear each maximize and fullscreen request a client makes. The compositor
   * grants none; grant one with {@link System.setWindowStates}. Allowed while
   * the desktop is locked.
   */
  windowRequests: () => Promise<Result<Listening<WindowRequest>, SystemError>>;
  /**
   * Add a monitor with no connector, which the desk extends onto and only a
   * capture shows: casting to a TV. A later `displays` lists it. It lasts
   * until removed, or until the page goes away. Fails
   * {@link SystemErrorKind.Other} on a desk whose monitors the engine does
   * not report: nested, or described by `output.displays`. See
   * docs/CASTING-TO-TVS.md.
   */
  addVirtualMonitor: (
    mode: VirtualMonitorMode,
  ) => Promise<Result<VirtualMonitor, SystemError>>;
  /**
   * Hear `input.keyboard`'s keymaps and the one the desktop types on, at once
   * and on each switch or reload. Allowed while the desktop is locked.
   */
  keymaps: () => Promise<Result<Listening<Keymaps>, SystemError>>;
  /**
   * Switch every keyboard to another of the config's keymaps, until the
   * desktop restarts. Fails {@link SystemErrorKind.NotFound} for a name the
   * config does not have. Allowed while the desktop is locked.
   */
  selectKeymap: (choice: KeymapChoice) => Promise<Result<"set", SystemError>>;
};

/** What {@link system} needs of the desktop `Shell` is handed. */
export type SystemHost = Pick<DomicileHost, "callSystem"> & {
  addEventListener: (
    type: "system",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
};

/** The system calls through `host`. Any number may share one host. */
export const system = (host: SystemHost): System => {
  const calls = callsOn(host);
  return {
    addVirtualMonitor: (mode) => addVirtualMonitor(calls, mode),
    createDir: (path) =>
      oneShot(calls, { call: "create_dir", path }, (reply) =>
        reply.kind === "created" ? "created" : unexpected(reply),
      ),
    dbusCall: (request) =>
      oneShot(
        calls,
        {
          body: JSON.stringify(request.body ?? []),
          bus: busName(request.bus),
          call: "dbus_call",
          destination: request.destination,
          interface: request.interface,
          member: request.member,
          path: request.path,
          signature: request.signature ?? "",
        },
        (reply) =>
          reply.kind === "returned"
            ? { body: dbusBody(reply.body), signature: reply.signature }
            : unexpected(reply),
      ),
    dbusMatch: (match) =>
      listening<Listened<DbusSignal>>(
        calls,
        {
          bus: busName(match.bus),
          call: "dbus_match",
          ...optional("sender", match.sender),
          ...optional("path", match.path),
          ...optional("interface", match.interface),
          ...optional("member", match.member),
        },
        (event) =>
          event.kind === "signal"
            ? Listened.Heard({
                body: dbusBody(event.body),
                interface: event.interface,
                member: event.member,
                path: event.path,
                sender: event.sender,
                signature: event.signature,
              })
            : unexpected(event),
        Listened.Missed(),
      ),
    idleWarnings: () =>
      listening(calls, { call: "idle_warnings" }, (event) =>
        event.kind === "idle_warning"
          ? (event.blanks_in_ms ?? undefined)
          : unexpected(event),
      ),
    keymaps: () =>
      listening(calls, { call: "keymaps" }, (event) =>
        event.kind === "keymaps"
          ? {
              active: event.active,
              keymaps: event.keymaps.map(({ description, name }) => ({
                description,
                name,
              })),
            }
          : unexpected(event),
      ),
    previewWindow: (window) =>
      oneShot(
        calls,
        { call: "preview_window", window: wirePreviewedWindow(window) },
        (reply) => (reply.kind === "preview" ? reply.frame : unexpected(reply)),
      ),
    readDir: (path) =>
      oneShot(calls, { call: "read_dir", path }, (reply) =>
        reply.kind === "entries"
          ? reply.entries.map(({ file_type, name }) => ({
              fileType: fileType(file_type),
              name,
            }))
          : unexpected(reply),
      ),
    readFile: (path, range) => readFile(calls, path, range),
    readTextFile: async (path) =>
      (await readFile(calls, path, undefined)).map((bytes) =>
        new TextDecoder().decode(bytes),
      ),
    run: async (argv, options) =>
      (await spawn(calls, argv, options)).andThenAsync(async (process) => {
        const [stdout, stderr, exited] = await Promise.all([
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
          process.exited,
        ]);
        return exited.map((exit) => ({ ...exit, stderr, stdout }));
      }),
    screenshot: () =>
      oneShot(calls, { call: "screenshot" }, (reply) => keptOf(reply)),
    selectKeymap: (choice) =>
      oneShot(
        calls,
        { call: "select_keymap", keymap: wireKeymapChoice(choice) },
        (reply) => (reply.kind === "set" ? "set" : unexpected(reply)),
      ),
    setWindowStates: (appId, states) =>
      oneShot(
        calls,
        {
          app_id: appId,
          call: "set_window_states",
          states: states.map(wireWindowState),
        },
        (reply) => (reply.kind === "set" ? "set" : unexpected(reply)),
      ),
    shellCommands: () =>
      listening(calls, { call: "shell_commands" }, (event) =>
        event.kind === "shell_command" ? event.command : unexpected(event),
      ),
    spawn: (argv, options) => spawn(calls, argv, options),
    stat: (path) =>
      oneShot(calls, { call: "stat", path }, (reply) =>
        reply.kind === "stat"
          ? {
              fileType: fileType(reply.file_type),
              modifiedMs: reply.modified_ms ?? undefined,
              size: reply.size,
            }
          : unexpected(reply),
      ),
    unlockRefusals: () =>
      listening(calls, { call: "unlock_refusals" }, (event) =>
        event.kind === "unlock_refused"
          ? {
              failures: event.failures,
              refusal: unlockRefusal(event.refusal),
              retryInMs: event.retry_in_ms,
            }
          : unexpected(event),
      ),
    watch: (path) =>
      listening<Listened<string>>(
        calls,
        { call: "watch", path },
        (event) =>
          event.kind === "changed"
            ? Listened.Heard(event.path)
            : unexpected(event),
        Listened.Missed(),
      ),
    windowRequests: () =>
      listening(calls, { call: "window_requests" }, (event) =>
        event.kind === "window_request"
          ? windowRequest(event.app_id, event.request)
          : unexpected(event),
      ),
    writeFile: (path, data, options) =>
      oneShot(
        calls,
        {
          atomic: options?.atomic ?? true,
          call: "write_file",
          data: toBase64(data),
          path,
        },
        (reply) => (reply.kind === "written" ? "written" : unexpected(reply)),
      ),
  };
};

type Reply = SystemReplyMessage["reply"];
type Event = SystemEventMessage["event"];
type End = SystemEndMessage["end"];
type WireError = Extract<Reply, { kind: "failed" }>["error"];

/** What a call in flight does with each answer under its id. */
type Handlers = {
  reply: (reply: Reply) => void;
  event: (event: Event) => void;
  end: (end: End) => void;
};

/** The calls in flight on one host, which name them. */
type Calls = {
  host: SystemHost;
  next: number;
  running: Map<number, Handlers>;
};

/** One registry per host, so two systems on a page never share an id. */
const registries = new WeakMap<SystemHost, Calls>();

const callsOn = (host: SystemHost): Calls => {
  const known = registries.get(host);
  if (known === undefined) {
    const calls: Calls = { host, next: 1, running: new Map() };
    host.addEventListener("system", (event) => {
      heard(calls, event.data);
    });
    registries.set(host, calls);
    return calls;
  } else {
    return known;
  }
};

/**
 * Hand a compositor line to the call it answers. An id with nothing here
 * belongs to another copy of this module on the same page.
 */
const heard = (calls: Calls, line: string): void => {
  const message = parseSystemMessage(line);
  const handlers = calls.running.get(message.id);
  if (handlers !== undefined) {
    switch (message.type) {
      case "system_reply": {
        handlers.reply(message.reply);
        break;
      }
      case "system_event": {
        handlers.event(message.event);
        break;
      }
      case "system_end": {
        calls.running.delete(message.id);
        handlers.end(message.end);
        break;
      }
    }
  }
};

/** Send `request` under a new id, with `handlers` for its answers. */
const call = (calls: Calls, request: object, handlers: Handlers): number => {
  const id = calls.next;
  calls.next = id + 1;
  calls.running.set(id, handlers);
  calls.host.callSystem(id, JSON.stringify(request));
  return id;
};

/** A call answered by one reply, which `read` turns into its value. */
const oneShot = <T extends NonNullable<unknown>>(
  calls: Calls,
  request: object,
  read: (reply: Reply) => T,
): Promise<Result<T, SystemError>> =>
  new Promise((resolve) => {
    const id = call(calls, request, {
      end: unexpected,
      event: unexpected,
      reply: (reply) => {
        calls.running.delete(id);
        resolve(
          reply.kind === "failed"
            ? Err(systemError(reply.error))
            : Ok(read(reply)),
        );
      },
    });
  });

const readFile = (
  calls: Calls,
  path: string,
  range: ByteRange | undefined,
): Promise<Result<Uint8Array, SystemError>> =>
  oneShot(
    calls,
    {
      call: "read_file",
      path,
      ...optional("offset", range?.offset),
      ...optional("length", range?.length),
    },
    (reply) =>
      reply.kind === "read" ? fromBase64(reply.data) : unexpected(reply),
  );

const spawn = (
  calls: Calls,
  argv: readonly string[],
  options: SpawnOptions | undefined,
): Promise<Result<Subprocess, SystemError>> =>
  new Promise((resolve) => {
    const stdout = streamed<Uint8Array>();
    const stderr = streamed<Uint8Array>();
    const exited = settled<Result<Exit, SystemError>>();
    const id = call(
      calls,
      {
        argv,
        call: "spawn",
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        env: options?.env ?? {},
        stdin: options?.stdin ?? false,
      },
      {
        end: (end) => {
          stdout.close();
          stderr.close();
          exited.settle(exitOf(end));
        },
        event: (event) =>
          event.kind === "output"
            ? (event.stream === "stdout" ? stdout : stderr).push(
                fromBase64(event.data),
              )
            : unexpected(event),
        reply: (reply) => {
          if (reply.kind === "failed") {
            calls.running.delete(id);
            resolve(Err(systemError(reply.error)));
          } else {
            resolve(
              reply.kind === "started"
                ? Ok({
                    closeStdin: () => {
                      calls.host.callSystem(
                        id,
                        JSON.stringify({ call: "close_stdin" }),
                      );
                    },
                    exited: exited.promise,
                    kill: (signal = Signal.Term) => {
                      calls.host.callSystem(
                        id,
                        JSON.stringify({
                          call: "kill",
                          signal: signalName(signal),
                        }),
                      );
                    },
                    stderr: stderr.stream,
                    stdout: stdout.stream,
                    write: (data) => {
                      calls.host.callSystem(
                        id,
                        JSON.stringify({ call: "stdin", data: toBase64(data) }),
                      );
                    },
                  })
                : unexpected(reply),
            );
          }
        },
      },
    );
  });

const addVirtualMonitor = (
  calls: Calls,
  mode: VirtualMonitorMode,
): Promise<Result<VirtualMonitor, SystemError>> =>
  new Promise((resolve) => {
    const ended = settled<Result<"removed", SystemError>>();
    const id = call(
      calls,
      {
        call: "virtual_monitor",
        height: mode.height,
        name: mode.name,
        refresh_mhz: mode.refreshMhz,
        width: mode.width,
      },
      {
        end: (end) => {
          ended.settle(stopOf(end).map(() => "removed" as const));
        },
        event: unexpected,
        reply: (reply) => {
          if (reply.kind === "failed") {
            calls.running.delete(id);
            resolve(Err(systemError(reply.error)));
          } else {
            resolve(
              reply.kind === "virtual_monitor"
                ? Ok({
                    ended: ended.promise,
                    output: reply.output,
                    remove: () => {
                      calls.host.callSystem(
                        id,
                        JSON.stringify({ call: "unwatch" }),
                      );
                    },
                  })
                : unexpected(reply),
            );
          }
        },
      },
    );
  });

/**
 * A call that streams `item`s from its events until `unwatch` stops it: a
 * watch or a D-Bus match. One the browser ends because the compositor exited
 * is sent again, under a new id: the browser holds it for the next compositor.
 * Once the next one starts it, `missed`, when given, is streamed: what changed
 * in between was not heard. See "A compositor restart" in
 * docs/architecture/ENGINE-FORK.md.
 */
const listening = <T>(
  calls: Calls,
  request: object,
  item: (event: Event) => T,
  missed?: T,
): Promise<Result<Listening<T>, SystemError>> =>
  new Promise((resolve) => {
    const items = streamed<T>();
    const ended = settled<Result<"stopped", SystemError>>();
    let current = 0;
    let answered = false;
    let stopped = false;
    const end = (result: Result<"stopped", SystemError>) => {
      items.close();
      ended.settle(result);
    };
    const subscribe = (): void => {
      const id = call(calls, request, {
        end: (wire) => {
          if (isGone(wire)) {
            again();
          } else {
            end(stopOf(wire));
          }
        },
        event: (event) => {
          items.push(item(event));
        },
        reply: (reply) => {
          if (reply.kind === "failed") {
            calls.running.delete(id);
            if (isGone(reply)) {
              again();
            } else if (answered) {
              end(Err(systemError(reply.error)));
            } else {
              resolve(Err(systemError(reply.error)));
            }
          } else if (reply.kind !== "started") {
            unexpected(reply);
          } else if (answered) {
            if (missed !== undefined) {
              items.push(missed);
            }
          } else {
            answered = true;
            resolve(
              Ok({
                ended: ended.promise,
                items: items.stream,
                stop: () => {
                  stopped = true;
                  calls.host.callSystem(
                    current,
                    JSON.stringify({ call: "unwatch" }),
                  );
                },
              }),
            );
          }
        },
      });
      current = id;
    };
    const again = (): void => {
      if (stopped) {
        end(Ok("stopped"));
      } else {
        subscribe();
      }
    };
    subscribe();
  });

/** Whether the browser ended a call because its compositor exited. */
const isGone = (answer: Reply | End): boolean =>
  answer.kind === "failed" && answer.error.kind === "compositor_gone";

/** A stream fed from outside, for answers that arrive as events. */
const streamed = <T>() => {
  let controller: ReadableStreamDefaultController<T> | undefined;
  const stream = new ReadableStream<T>({
    start: (started) => {
      controller = started;
    },
  });
  const opened = (): ReadableStreamDefaultController<T> => {
    if (controller === undefined) {
      throw new Error("a ReadableStream's start runs in its constructor");
    } else {
      return controller;
    }
  };
  return {
    close: () => {
      opened().close();
    },
    push: (value: T) => {
      opened().enqueue(value);
    },
    stream,
  };
};

/** A promise settled from outside. */
const settled = <T>() => {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, settle: resolve };
};

const exitOf = (end: End): Result<Exit, SystemError> => {
  switch (end.kind) {
    case "exited": {
      return Ok({
        code: end.code ?? undefined,
        signal: end.signal ?? undefined,
      });
    }
    case "failed": {
      return Err(systemError(end.error));
    }
    case "stopped": {
      return unexpected(end);
    }
  }
};

const stopOf = (end: End): Result<"stopped", SystemError> => {
  switch (end.kind) {
    case "stopped": {
      return Ok("stopped");
    }
    case "failed": {
      return Err(systemError(end.error));
    }
    case "exited": {
      return unexpected(end);
    }
  }
};

/** An answer the protocol does not allow at this point: a compositor bug. */
/** `window` as a `preview_window` call names it. */
const wirePreviewedWindow = (
  window: PreviewedWindow,
): { id: string; type: "app" | "browser" } => {
  switch (window.kind) {
    case PreviewedWindowKind.App:
      return { id: window.id, type: "app" };
    case PreviewedWindowKind.Browser:
      return { id: window.id, type: "browser" };
  }
};

/** Where a screenshot call's reply says the screenshot went. */
const keptOf = (reply: Reply): ScreenshotKept => {
  switch (reply.kind) {
    case "saved":
      return ScreenshotKept.Saved(reply.path);
    case "copied":
      return ScreenshotKept.Copied();
    default:
      return unexpected(reply);
  }
};

type WireWindowRequest = Extract<Event, { kind: "window_request" }>["request"];

const windowRequest = (
  appId: string,
  request: WireWindowRequest,
): WindowRequest => {
  switch (request.kind) {
    case "maximize":
      return WindowRequest.Maximize(appId);
    case "unmaximize":
      return WindowRequest.Unmaximize(appId);
    case "fullscreen":
      return WindowRequest.Fullscreen(appId, request.display ?? undefined);
    case "unfullscreen":
      return WindowRequest.Unfullscreen(appId);
  }
};

const unexpected = (answer: unknown): never => {
  throw new Error(`an unexpected system answer: ${JSON.stringify(answer)}`);
};

const systemError = (error: WireError): SystemError => ({
  kind: errorKind(error.kind),
  message: error.message,
});

const errorKind = (kind: WireError["kind"]): SystemErrorKind => {
  switch (kind) {
    case "not_found": {
      return SystemErrorKind.NotFound;
    }
    case "permission_denied": {
      return SystemErrorKind.PermissionDenied;
    }
    case "already_exists": {
      return SystemErrorKind.AlreadyExists;
    }
    case "not_a_directory": {
      return SystemErrorKind.NotADirectory;
    }
    case "is_a_directory": {
      return SystemErrorKind.IsADirectory;
    }
    case "invalid_input": {
      return SystemErrorKind.InvalidInput;
    }
    case "locked": {
      return SystemErrorKind.Locked;
    }
    case "dbus": {
      return SystemErrorKind.Dbus;
    }
    case "canceled": {
      return SystemErrorKind.Canceled;
    }
    case "compositor_gone": {
      return SystemErrorKind.CompositorGone;
    }
    case "other": {
      return SystemErrorKind.Other;
    }
  }
};

/** A D-Bus body's JSON text, as the array the page reads. */
const dbusBody = (text: string): unknown[] =>
  dbusBodySchema.parse(JSON.parse(text));

const dbusBodySchema = z.array(z.unknown());

const busName = (bus: Bus): string => {
  switch (bus) {
    case Bus.Session: {
      return "session";
    }
    case Bus.System: {
      return "system";
    }
  }
};

/** `{ [name]: value }`, or nothing when `value` is absent. */
const optional = (name: string, value: string | number | undefined) =>
  value === undefined ? {} : { [name]: value };

const fileType = (
  type: "file" | "directory" | "symlink" | "other",
): FileType => {
  switch (type) {
    case "file":
      return FileType.File;
    case "directory":
      return FileType.Directory;
    case "symlink":
      return FileType.Symlink;
    case "other":
      return FileType.Other;
  }
};

const unlockRefusal = (
  refusal: "wrong_passphrase" | "unverifiable" | "too_soon",
): UnlockRefusal => {
  switch (refusal) {
    case "wrong_passphrase":
      return UnlockRefusal.WrongPassphrase;
    case "unverifiable":
      return UnlockRefusal.Unverifiable;
    case "too_soon":
      return UnlockRefusal.TooSoon;
  }
};

const signalName = (signal: Signal): string => {
  switch (signal) {
    case Signal.Hup:
      return "hup";
    case Signal.Int:
      return "int";
    case Signal.Term:
      return "term";
    case Signal.Kill:
      return "kill";
    case Signal.Usr1:
      return "usr1";
    case Signal.Usr2:
      return "usr2";
  }
};

const toBase64 = (data: Uint8Array | string): string =>
  btoa(
    Array.from(
      typeof data === "string" ? new TextEncoder().encode(data) : data,
      (byte) => String.fromCharCode(byte),
    ).join(""),
  );

const fromBase64 = (data: string): Uint8Array =>
  Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
