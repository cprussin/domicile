// One call that finds the host, whichever way this page was opened.
//
// A shell's page runs in three places and the difference is not the shell's
// business:
//
//   the fork      what we ship. No preload and no world boundary, so the page
//                 opens a WebSocket to the bridge that holds the compositor's
//                 session socket — same origin as the page itself, because the
//                 one process serves both
//   Electron      scaffolding, on its way out (see electron-chrome-host's own
//                 README). The socket is the preload's and `postMessage` is how
//                 it crosses; `window.domicileHost` is how the page knows
//   a browser     no host at all. `vite dev` on a shell's page is a real thing
//                 to do, and it must lay out rather than throw
//
// WRITING-A-SHELL.md has every shell branching on `window.domicileHost` by
// hand, which was one branch when there was one alternative. This is that
// branch, once, so a shell is `new BridgeClient(connectToHost())` and the
// requirement that a React developer gets a desktop out of a few lines around
// `ReactDOM.render` survives the fork arriving.
//
// The URL is derived rather than configured. The bridge serves the page and
// the session from the same origin exactly so that there is nothing to pass:
// no query string for a shell to forward, no port for anyone to write down,
// and no way for the two to disagree.

import type { Transport } from "./bridge";
import type { HostChannel } from "./host-transport";
import { postedTransport } from "./host-transport";
import { webSocketTransport } from "./websocket-transport";

/** Where the session is served, on the page's own origin. */
export const SESSION_PATH = "/domicile-session";

/**
 * Whether anything will ever describe a desktop to this page.
 *
 * A second question from `connectToHost`'s, and one a shell genuinely has to
 * ask: with no host there is no display to lay windows out on, so a shell
 * takes the viewport's geometry instead. It used to be spelled
 * `window.domicileHost === undefined`, which stopped meaning that the moment
 * the fork arrived — under the fork there is no injected channel and there
 * very much is a host.
 *
 * `connectToHost` is written in terms of this so the two cannot disagree.
 */
export const hasHost = (target: HostWindow): boolean => {
  if (target.domicileHost !== undefined) {
    return true;
  }
  const { host, protocol } = target.location;
  return (protocol === "http:" || protocol === "https:") && host !== "";
};

/** The globals this reads, named so a test can supply them. */
export type HostWindow = {
  readonly domicileHost?: HostChannel | undefined;
  readonly location: { readonly protocol: string; readonly host: string };
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown; source: unknown }) => void,
  ) => void;
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
  // Electron first: when a preload has injected a channel it is the one to
  // use, and a fork-shaped guess would open a socket to nothing.
  const injected = target.domicileHost;
  if (injected !== undefined) {
    return postedTransport(target, injected);
  }

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
