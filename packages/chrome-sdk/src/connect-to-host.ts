// One call that finds the host, whichever way this page was opened.
//
// A shell's page runs in two places and the difference is not the shell's
// business:
//
//   the fork      what we ship. No preload and no world boundary, so the page
//                 opens a WebSocket to the bridge that holds the compositor's
//                 session socket — same origin as the page itself, because the
//                 one process serves both
//   a browser     no host at all. `vite dev` on a shell's page is a real thing
//                 to do, and it must lay out rather than throw
//
// There was a third: an Electron whose preload injected a channel at
// `window.domicileHost`, which the page took over a `postMessage` boundary.
// The fork has no preload and no world to cross, and Electron is gone from
// this repository entirely — so that branch is gone with it rather than kept
// as a shape nothing produces.
//
// WRITING-A-SHELL.md used to have every shell branching on the host by hand.
// This is that branch, once, so a shell is `new BridgeClient(connectToHost())`
// and the requirement that a React developer gets a desktop out of a few lines
// around `ReactDOM.render` survives.
//
// The URL is derived rather than configured. The bridge serves the page and
// the session from the same origin exactly so that there is nothing to pass:
// no query string for a shell to forward, no port for anyone to write down,
// and no way for the two to disagree.

import type { Transport } from "./bridge";
import { webSocketTransport } from "./websocket-transport";

/** Where the session is served, on the page's own origin. */
export const SESSION_PATH = "/domicile-session";

/**
 * Whether anything will ever describe a desktop to this page.
 *
 * A second question from `connectToHost`'s, and one a shell genuinely has to
 * ask: with no host there is no display to lay windows out on, so a shell
 * takes the viewport's geometry instead.
 *
 * `connectToHost` is written in terms of this so the two cannot disagree.
 */
export const hasHost = (target: HostWindow): boolean => {
  const { host, protocol } = target.location;
  return (protocol === "http:" || protocol === "https:") && host !== "";
};

/** The globals this reads, named so a test can supply them. */
export type HostWindow = {
  readonly location: { readonly protocol: string; readonly host: string };
};

/**
 * A [`Transport`] to the compositor, or one that does nothing.
 *
 * **The no-op is not a failure and must not throw.** A shell's page opened in
 * an ordinary browser has no host and should still render: that is how a shell
 * is styled, and how its layout is worked on, without a desktop running. What
 * it will not do is show a window, and `<domicile-app>` says so once on its
 * own account.
 */
export const connectToHost = (
  target: HostWindow,
  open: (url: string) => Parameters<typeof webSocketTransport>[0],
): Transport => {
  // `http:` and `https:` and nothing else, which is what `hasHost` decides. A
  // page on `file:` has a `location` whose `host` is empty, and `ws://` at an
  // empty host is not a URL — it would throw where this promises not to.
  if (hasHost(target)) {
    const { host, protocol } = target.location;
    const scheme = protocol === "https:" ? "wss:" : "ws:";
    return webSocketTransport(open(`${scheme}//${host}${SESSION_PATH}`));
  }

  return {
    onMessage: () => undefined,
    send: () => undefined,
  };
};
