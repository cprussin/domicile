// Starting the compositor.
//
// This is the inversion the rest of Domicile is arranged around: a shell is not
// something the compositor launches, it is the program the *user* runs, and the
// compositor is what it starts underneath itself. So the shell picks the paths,
// writes the configuration, and waits to be told what was bound.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as after } from "node:timers/promises";

import { awaitSession } from "./await-session";
import { compositorCommand } from "./compositor-command";
import type { CompositorConfig } from "./compositor-config";
import { configDocument } from "./compositor-config";
import type { CompositorSession } from "./compositor-session";

/** What the compositor is called when nothing on the machine says otherwise. */
const PROGRAM = "domicile-compositor";

/** How long to leave between looks for the published session. */
const LOOK_EVERY_MS = 20;

/**
 * How long a compositor gets to go down on a TERM before it is killed.
 *
 * There has to be a deadline. A compositor wedged in a GL call never answers,
 * and `stop()` is what the user's own quit waits behind: without this the
 * desktop closes, the terminal never comes back, and the run directory — with
 * a live socket in it — stays.
 */
const GRACE_MS = 2000;

/** What a shell asks for when it starts a compositor. */
export type StartCompositorOptions = {
  /** The desktop to run. Omitted means the compositor's own defaults. */
  config?: CompositorConfig | undefined;
  /**
   * Draw client windows in a window of the compositor's own.
   *
   * What a desktop on a screen wants. Off is the headless arrangement, where
   * client frames arrive as pixels for the page to draw itself.
   */
  present: boolean;
  /** The compositor binary. Defaults to `domicile-compositor` on `PATH`. */
  program?: string | undefined;
  /**
   * A stop that arrives while the compositor is still coming up.
   *
   * Bringing one up takes seconds, and a launcher that could only be stopped
   * afterwards left the compositor it had already spawned behind. Aborting
   * makes this call give up and take its own run down: the process, the
   * directory, the socket.
   */
  stopping?: AbortSignal | undefined;
};

/** A compositor this process started and is responsible for. */
export type RunningCompositor = {
  /** What it published: the sockets to connect to, and the displays. */
  session: CompositorSession;
  /** Resolves with a reason when it exits, however that happens. */
  stopped: Promise<string>;
  /** End it, and wait until it is gone. */
  stop: () => Promise<void>;
};

/**
 * Start a compositor and wait until it is serving.
 *
 * Throws if it stops before publishing a session, carrying whatever it said on
 * stderr: that is where a compositor explains a display it could not open or a
 * config it could not read, and it is the only useful thing a shell has to
 * show for a desktop that never appeared.
 */
export const startCompositor = async ({
  config,
  present,
  program,
  stopping,
}: StartCompositorOptions): Promise<RunningCompositor> => {
  // Short, because a Unix socket path is capped near 108 bytes and the socket
  // lives in here. `XDG_RUNTIME_DIR` is the right home for a running session's
  // files; a machine without one gets the temp directory.
  // biome-ignore lint/style/noProcessEnv: this is the main process; it is its own env.
  const environment = process.env;
  const directory = await mkdtemp(
    path.join(environment.XDG_RUNTIME_DIR ?? tmpdir(), "domicile-"),
  );
  const sessionFile = path.join(directory, "session.json");
  // Under its own guard from here: a `writeFile` that fails — a full
  // `XDG_RUNTIME_DIR`, a tmpfs quota — would otherwise leave the directory
  // behind with nothing left to remove it, since `stop` does not exist yet.
  const configFile = await orRemove(directory, async () =>
    config === undefined ? undefined : written(directory, config),
  );

  const command = compositorCommand({
    chromeSocket: path.join(directory, "chrome.sock"),
    configFile,
    present,
    program: program ?? environment.DOMICILE_COMPOSITOR ?? PROGRAM,
    sessionFile,
  });
  // stderr is piped rather than inherited so the reason a compositor refused
  // to start can be put in the error a shell reports; it is echoed on, because
  // everything it says after that is still a compositor's log.
  const child = spawn(command.program, command.args, {
    stdio: ["ignore", "inherit", "pipe"],
  });
  // Kept only until the session is published, and only to explain a compositor
  // that would not *start*. After that every byte it ever writes — panics,
  // tracing, a client library's warnings — would accumulate in the launcher's
  // heap for the life of the desktop, read by nothing.
  const complaint = { keeping: true, text: "" };
  child.stderr.on("data", (chunk: Buffer) => {
    if (complaint.keeping) {
      complaint.text += chunk.toString();
    }
    // Echoed on either way: what a compositor says after it is up is still a
    // compositor's log, and it belongs on the terminal the shell was run from.
    process.stderr.write(chunk);
  });

  const stopped = new Promise<string>((resolve) => {
    child.on("error", (err) => {
      resolve(`it could not be started: ${err.message}`);
    });
    // `close` rather than `exit`: `exit` fires while stderr may still have
    // buffered data, so the reason the compositor gave for refusing to start
    // would be missing from the error reporting it — intermittently, which is
    // worse than never.
    child.on("close", (code, signal) => {
      resolve(ended(command.program, code, signal, complaint.text));
    });
  });

  const stop = async (): Promise<void> => {
    const grace = new AbortController();
    try {
      child.kill();
      await Promise.race([stopped, killedAfterGrace(child, grace.signal)]);
    } finally {
      // Cancelled rather than left to fire. A `setTimeout` still armed holds
      // the launcher's event loop open until it goes off, so a desktop that
      // closed cleanly used to sit for the whole grace before its terminal
      // came back — the very wait the deadline was added to remove.
      grace.abort();
      // And the directory goes whether or not it went quietly: one left behind
      // is one live socket per session that ended badly.
      await rm(directory, { force: true, recursive: true });
    }
  };

  try {
    const session = await awaitSession({
      delay: () => after(LOOK_EVERY_MS),
      failed: Promise.race([stopped, aborted(stopping)]),
      read: () => readFile(sessionFile, "utf8").catch(notYet),
    });
    complaint.keeping = false;
    return { session, stop, stopped };
  } catch (cause) {
    await stop();
    throw cause;
  }
};

/**
 * A compositor that did not take the TERM, killed once its grace is up.
 *
 * `SIGKILL` is delivered rather than obeyed, so nothing is waited on after it:
 * racing this against the process's own exit is the whole point, and a second
 * wait here would put back the hang it exists to remove.
 */
const killedAfterGrace = async (
  child: ChildProcess,
  grace: AbortSignal,
): Promise<void> => {
  await after(GRACE_MS, undefined, { signal: grace });
  child.kill("SIGKILL");
};

/**
 * A stop that arrived while the compositor was still coming up, as a reason to
 * give up waiting for it. Never, when the caller passed no way to stop.
 *
 * The already-aborted case is not an optimisation. Everything before this call
 * — making the run directory, writing the config, the spawn — is time a stop
 * can land in, and `addEventListener` on a signal that has already aborted
 * never fires: the event was dispatched once, before the listener existed. A
 * Ctrl-C in the first milliseconds was dropped outright, and the desktop came
 * up anyway.
 */
const aborted = (stopping: AbortSignal | undefined): Promise<string> => {
  if (stopping === undefined) {
    return new Promise(() => undefined);
  } else if (stopping.aborted) {
    return Promise.resolve(STOPPED_EARLY);
  } else {
    return new Promise((resolve) => {
      stopping.addEventListener("abort", () => {
        resolve(STOPPED_EARLY);
      });
    });
  }
};

/** Why a compositor that was still coming up is not going to be waited for. */
const STOPPED_EARLY = "the shell was stopped before it came up";

/** Run `work`, taking `directory` with it if it throws. */
const orRemove = async <T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } catch (cause) {
    await rm(directory, { force: true, recursive: true });
    throw cause;
  }
};

/**
 * "The compositor has not published yet", and nothing else.
 *
 * Only `ENOENT`: a session directory that cannot be read at all — the wrong
 * permissions, a path that is not a directory — would otherwise look exactly
 * like a compositor still starting up, and be waited out until it exited.
 */
const notYet = (cause: NodeJS.ErrnoException): undefined => {
  if (cause.code === "ENOENT") {
    return undefined;
  } else {
    throw cause;
  }
};

/** Write the compositor's config into the run's directory, and say where. */
const written = async (
  directory: string,
  config: CompositorConfig,
): Promise<string> => {
  const file = path.join(directory, "config.json");
  await writeFile(file, JSON.stringify(configDocument(config)));
  return file;
};

/** How a compositor's exit reads in the error a shell reports. */
const ended = (
  program: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  complaint: string,
): string => {
  const how =
    signal === null
      ? `exited with status ${code ?? "unknown"}`
      : `was ${signal}`;
  return complaint === ""
    ? `${program} ${how}`
    : `${program} ${how}: ${complaint.trim()}`;
};
