// The types of the compositor's system calls: their errors, files, processes,
// D-Bus and watches. A shell makes the calls through its desktop's
// namespaces; see docs/SHELL-SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";

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
