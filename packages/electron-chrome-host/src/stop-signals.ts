// How a desktop is asked to stop, and what it reports when it does.
//
// Its own module because the launcher is what a user's session manager
// signals, and which signals those are is a fact worth stating once and
// checking rather than a list inside a closure.

import { constants } from "node:os";

/**
 * The signals a desktop is stopped with, forwarded to the chrome.
 *
 * `SIGHUP` is the one that is easy to leave out and the one that actually
 * happens: a closed terminal, a `systemd --user` unit being stopped, a login
 * session going away. Node terminates on it by default, so a launcher without
 * a handler dies where it stands — leaving a compositor and an Electron behind,
 * one of each per session ended that way, each holding a socket.
 */
export const STOP_SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

/**
 * The status a shell exits with, given how its chrome ended.
 *
 * A process killed by a signal has no status of its own; the shell convention
 * is 128 plus the signal's number.
 */
export const exitStatus = (
  code: number | null,
  signal: NodeJS.Signals | null,
): number => {
  if (signal !== null) {
    return 128 + signalNumber(signal);
  } else if (code === null) {
    // Node gives one or the other for every process it reaped. Answering 0
    // here would report success for a chrome nobody can account for, and a
    // shell's status is what a session manager's restart policy branches on.
    throw new Error(
      "domicile: the chrome ended with neither a status nor a signal",
    );
  } else {
    return code;
  }
};

/**
 * A signal's number, as the platform has it.
 *
 * Looked up rather than listed. A table of the three a desktop is *stopped*
 * with, answering `SIGKILL`'s 9 for everything else, reported the signals a
 * chrome actually dies of — `SIGSEGV`, `SIGABRT` from a V8 OOM, `SIGBUS` — as
 * 137, which every init system reads as the OOM killer having taken it.
 */
const signalNumber = (signal: NodeJS.Signals): number => {
  const number = constants.signals[signal];
  if (number === undefined) {
    throw new Error(`domicile: ${signal} is not a signal this platform has`);
  } else {
    return number;
  }
};
