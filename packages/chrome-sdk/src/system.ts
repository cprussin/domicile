// Files, watches and processes for a shell: the compositor's system calls,
// typed. See docs/architecture/SYSTEM-ACCESS.md.
//
// Each call goes out through `callSystem` with an id, and its answers come
// back as `system` events carrying that id. A call that can fail resolves a
// `Result`; a bug in the protocol throws.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

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

/** What {@link System.run} collected. */
export type Ran = Exit & { stdout: string; stderr: string };

export type Watch = {
  /** The absolute path of each change. Closes when the watch ends. */
  changes: ReadableStream<string>;
  stop: () => void;
  /** `Ok` after {@link Watch.stop}, `Err` if the watch broke. */
  ended: Promise<Result<"stopped", SystemError>>;
};

/**
 * The calls. A relative path starts at the home. The compositor runs each in
 * the desktop's environment and refuses most of them while the desktop is
 * locked.
 */
export type System = {
  readFile: (path: string) => Promise<Result<Uint8Array, SystemError>>;
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
    readDir: (path) =>
      oneShot(calls, { call: "read_dir", path }, (reply) =>
        reply.kind === "entries"
          ? reply.entries.map(({ file_type, name }) => ({
              fileType: fileType(file_type),
              name,
            }))
          : unexpected(reply),
      ),
    readFile: (path) => readFile(calls, path),
    readTextFile: async (path) =>
      (await readFile(calls, path)).map((bytes) =>
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
    watch: (path) => watch(calls, path),
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
): Promise<Result<Uint8Array, SystemError>> =>
  oneShot(calls, { call: "read_file", path }, (reply) =>
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

const watch = (
  calls: Calls,
  path: string,
): Promise<Result<Watch, SystemError>> =>
  new Promise((resolve) => {
    const changes = streamed<string>();
    const ended = settled<Result<"stopped", SystemError>>();
    const id = call(
      calls,
      { call: "watch", path },
      {
        end: (end) => {
          changes.close();
          ended.settle(stopOf(end));
        },
        event: (event) =>
          event.kind === "changed"
            ? changes.push(event.path)
            : unexpected(event),
        reply: (reply) => {
          if (reply.kind === "failed") {
            calls.running.delete(id);
            resolve(Err(systemError(reply.error)));
          } else {
            resolve(
              reply.kind === "started"
                ? Ok({
                    changes: changes.stream,
                    ended: ended.promise,
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
      },
    );
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
    case "other": {
      return SystemErrorKind.Other;
    }
  }
};

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
