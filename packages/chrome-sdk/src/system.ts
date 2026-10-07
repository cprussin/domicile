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
import type {
  SystemEndMessage,
  SystemEventMessage,
  SystemReplyMessage,
} from "./system-message";
import { parseSystemMessage } from "./system-message";

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
  Other,
}

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

/** Part of a file: from `offset` (0 by default), `length` bytes or to the end. */
export type ByteRange = {
  offset?: number;
  length?: number;
};

/** What {@link System.run} collected. */
export type Ran = Exit & { stdout: string; stderr: string };

/** A watch's `items` are the absolute path of each change. */
export type Watch = Listening<string>;

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
  ) => Promise<Result<Listening<DbusSignal>, SystemError>>;
  /**
   * Take a screenshot as an interactive Screenshot portal call takes one, as
   * if the shell were the application: the desk freezes, `<PortalDialogs />`
   * draws the screenshot dialog, and the area picked is saved under
   * `$XDG_PICTURES_DIR/Screenshots/`. Resolves with the saved PNG's path.
   */
  screenshot: () => Promise<Result<string, SystemError>>;
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
      listening(
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
            ? {
                body: dbusBody(event.body),
                interface: event.interface,
                member: event.member,
                path: event.path,
                sender: event.sender,
                signature: event.signature,
              }
            : unexpected(event),
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
      oneShot(calls, { call: "screenshot" }, (reply) =>
        reply.kind === "saved" ? reply.path : unexpected(reply),
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
    watch: (path) =>
      listening(calls, { call: "watch", path }, (event) =>
        event.kind === "changed" ? event.path : unexpected(event),
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

/**
 * A call that streams `item`s from its events until `unwatch` stops it: a
 * watch or a D-Bus match.
 */
const listening = <T>(
  calls: Calls,
  request: object,
  item: (event: Event) => T,
): Promise<Result<Listening<T>, SystemError>> =>
  new Promise((resolve) => {
    const items = streamed<T>();
    const ended = settled<Result<"stopped", SystemError>>();
    const id = call(calls, request, {
      end: (end) => {
        items.close();
        ended.settle(stopOf(end));
      },
      event: (event) => {
        items.push(item(event));
      },
      reply: (reply) => {
        if (reply.kind === "failed") {
          calls.running.delete(id);
          resolve(Err(systemError(reply.error)));
        } else {
          resolve(
            reply.kind === "started"
              ? Ok({
                  ended: ended.promise,
                  items: items.stream,
                  stop: () => {
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
    });
  });

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
