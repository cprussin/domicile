import type { HandshakeFailure } from "@domicile/chrome-sdk/bridge";
import { describeHandshakeFailure } from "@domicile/chrome-sdk/bridge";

/**
 * What a refused handshake costs the shell.
 *
 * The same conclusion as `socket-failure`, for the other way the compositor
 * can be unusable: there the socket is gone, here it is answering and the two
 * halves disagree about what they are saying. Neither has anything to recover
 * to — the chrome is the compositor's client, and a page that cannot read the
 * desktop cannot draw one — so both say which and stop.
 *
 * Stopping is what makes this more than a printed line. A refused handshake
 * carries no desktop, and the chrome draws nothing until it has been told one,
 * so a shell that only reported would be a blank window that exited zero, with
 * its one explanation on stdout among the frame-timing reports.
 *
 * `fail` is injected, and is one function rather than a report and an exit,
 * for the reason `socket-failure` gives: saying why and stopping is one
 * action, and the renderer can do neither half itself. Unlike that one, the
 * caller here is the *page* rather than the preload, so the same channel is
 * reached across the context bridge — see `domicileFailure`.
 *
 * Its own module for the same reason as its neighbour: a test can reach it
 * without Electron, which does not load outside Electron.
 */
export const handshakeFailed = (fail: (line: string, code: number) => void) => {
  return (failure: HandshakeFailure): void => {
    fail(`domicile: ${describeHandshakeFailure(failure)}\n`, 1);
  };
};
