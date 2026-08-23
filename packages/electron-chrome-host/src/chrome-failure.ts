// The failure channel, and both its ends: how a chrome says it cannot go on,
// and what the host does about it.
//
// Saying why and stopping is one action, and a page can do neither half of it:
// `app.exit` is the main process's, and so is the file descriptor the reason
// goes to. So the page reports and the host acts, and all three — the name and
// the two halves — are here together, because a channel whose reader is copied
// into every consumer is only half a contract.
//
// It is the one channel every chrome needs. A channel a single chrome needs —
// the diagnostics it prints, the shortcuts a `<webview>` would otherwise
// swallow — is declared next to the code that uses it, in that chrome.

/**
 * Chrome → terminal, and then out: a line for stderr and an exit code.
 *
 * One channel rather than two because dying with a reason is one action, and a
 * page cannot do either half of it: `app.exit` is the main process's, and so is
 * the file descriptor the reason goes to.
 */
export const CHROME_FAILURE_CHANNEL = "domicile:failure";

/**
 * A reason for stderr and an exit code: what a chrome sends down the channel,
 * and equally what the main process is handed when the failure is its own.
 */
export type ReportFailure = (line: string, code: number) => void;

/** The main process's IPC, as much of it as the host side needs. */
export type FailureIpc = {
  on: (
    channel: string,
    listener: (event: unknown, line: string, code: number) => void,
  ) => void;
};

/**
 * The two halves of the one action, which only the main process has: the file
 * descriptor a reason goes to, and stopping.
 */
export type SayAndStop = {
  exit: (code: number) => void;
  write: (line: string) => void;
};

/** That, plus where a page's reasons arrive. */
export type ChromeFailureHost = SayAndStop & {
  ipc: FailureIpc;
};

/**
 * The page's reporter: whichever failure speaks first is the one heard.
 *
 * `app.exit` does not stop an IPC message already queued behind it, so two
 * failures arriving together — a throw at preload scope and the socket error it
 * left in flight — both reach the terminal, and the second is at best redundant
 * and at worst a wrong account of the first. Whichever spoke first is the one
 * that knows.
 */
export const reportOnce = (send: ReportFailure): ReportFailure => {
  let said = false;
  return (line, code) => {
    if (!said) {
      said = true;
      send(line, code);
    }
  };
};

/**
 * Run a preload's body, reporting a throw at preload scope rather than letting
 * Electron swallow it.
 *
 * Electron catches one, logs it to the renderer's devtools console — which
 * nobody has open while using a desktop — and then loads the page anyway, where
 * the transport is missing and a shell's own no-op fallback brings up a
 * permanently deaf desktop. A chrome that cannot reach the compositor has to say
 * so where it can be read, and stop.
 */
export const orDie = (fail: ReportFailure, start: () => void): void => {
  try {
    start();
  } catch (failure: unknown) {
    fail(`domicile: the chrome could not start: ${reasonFor(failure)}\n`, 1);
  }
};

/**
 * The same for a start that is a promise rather than a block: `app.whenReady`
 * and everything chained onto it.
 *
 * A main process's outermost `.catch` is the one it can least afford to throw
 * from — see {@link failHere} for why a throw there reports nothing, and note
 * that a start which failed before its window went up leaves no window for
 * `window-all-closed` to fire on either, so the process does not even exit 0.
 * It stays up with nothing in it.
 */
export const orDieStarting = (
  fail: ReportFailure,
  started: Promise<void>,
): void => {
  started.catch((failure: unknown) => {
    fail(
      `domicile: the shell could not open its window: ${reasonFor(failure)}\n`,
      1,
    );
  });
};

/**
 * The host's end: write the chrome's reason to stderr and stop.
 *
 * `exit` rather than `quit`: a page must not be able to veto the shutdown from
 * `beforeunload`, and the code has to be non-zero. Both it and `write` are
 * passed in rather than reached for, so this loads and is tested outside
 * Electron.
 */
export const stopOnChromeFailure = ({
  exit,
  ipc,
  write,
}: ChromeFailureHost): void => {
  const fail = failHere({ exit, write });
  ipc.on(CHROME_FAILURE_CHANNEL, (_event, line: string, code: number) => {
    fail(line, code);
  });
};

/**
 * What to put in a reason line for something thrown or rejected with.
 *
 * `String(error)` is not it: an `Error` stringifies with its class name on the
 * front, so the line would read `…could not start: Error: no socket`. Anything
 * else can be thrown — a dependency's string, a rejected `undefined` — and the
 * line still has to read.
 */
export const reasonFor = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

/**
 * The main process saying why and stopping on its own behalf.
 *
 * The same action {@link stopOnChromeFailure} performs for a page, reachable
 * where the failure is the host's own — a window that will not load its page,
 * a stylesheet that would not go in. It is not enough there to throw: Electron
 * pins Node's legacy `--unhandled-rejections=warn`, so a throw inside a
 * `.catch` in this process prints an `UnhandledPromiseRejectionWarning` to a
 * stderr nobody is reading and then carries on to exit 0 — which is the
 * swallowed failure it looks like the opposite of. A synchronous throw is no
 * better: Electron's default handler puts up a message box and waits.
 */
export const failHere =
  ({ exit, write }: SayAndStop): ReportFailure =>
  (line, code) => {
    // In that order, and the order is the whole of it: `app.exit` terminates
    // the process, so a write after it never runs and the reason is lost.
    write(line);
    exit(code);
  };
