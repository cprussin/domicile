// The preload's connection to the compositor, and everything that can go wrong
// with it.
//
// The preload holds this socket itself rather than receiving its messages from
// the main process, and that is the point of it: Electron's IPC
// structured-clones what it carries, which for a frame's pixels is megabytes
// per frame across a process boundary — measured at 79ms average against ~8ms
// for the GPU readback that produced them.
//
// What is here is the part that is not obvious: a peer that dies sends a FIN
// rather than an error, an error is always followed by a close, and a page
// reloading closes the socket without anything having died. Each of those was
// found once, and lives here so both shells get the answer.

import net from "node:net";

/**
 * As much of a `net.Socket` as this needs, so a test can hold one.
 *
 * `off` is narrowed to `close` because that is the only handler this takes
 * back off again.
 */
export type CompositorSocket = {
  destroy: () => void;
  off: (event: "close", listener: (hadError: boolean) => void) => void;
  on: {
    (event: "close", listener: (hadError: boolean) => void): void;
    (event: "data", listener: (chunk: Uint8Array) => void): void;
    (event: "error", listener: (failure: Error) => void): void;
  };
  write: (text: string) => void;
};

/** The byte stream the page's transport is built on. */
export type HostStream = {
  onData: (listener: (chunk: Uint8Array) => void) => void;
  write: (text: string) => void;
};

export type CompositorHost = {
  /**
   * Say why on stderr and stop.
   *
   * One function rather than a report and an exit, because saying why and
   * stopping is one action — and injected because the caller holding the socket
   * is the renderer, which can do neither half itself.
   */
  fail: (line: string, code: number) => void;
  /** How this page says it is going away: a reload, or the app quitting. */
  onPageHide: (listener: () => void) => void;
  path: string;
};

/**
 * Open the compositor socket and keep an honest account of its life.
 *
 * @returns The byte stream to build the page's transport on.
 */
export const connectToCompositor = (
  { fail, onPageHide, path }: CompositorHost,
  open: typeof openSocket = openSocket,
): HostStream => {
  const socket = open(path);
  const lost = lostCompositor(fail, path);
  socket.on("error", lost);
  // `error` is not the common way to lose a compositor. A peer that dies on a
  // Unix stream socket sends a FIN, which Node reports as `end` then `close`
  // and never as an error — so without this the desktop goes on drawing a still
  // of a machine that is gone.
  //
  // `hadError` is what keeps this from speaking over the `error` handler. Node
  // emits `close` after *every* `error`, so an unguarded one reports a second
  // time and gets it wrong: a socket that was never there reads as a compositor
  // that closed the connection, which is the commonest failure there is
  // followed by a false account of it.
  const compositorClosed = (hadError: boolean): void => {
    if (!hadError) {
      lost(new Error("the compositor closed the connection"));
    }
  };
  socket.on("close", compositorClosed);
  // Except when it is *this page* going away. A reload — or the window closing
  // on the way out of the app — tears the preload's Node environment down with
  // the document, and the socket closing on the way is not a compositor that
  // died. Read as one it would print a failure and exit non-zero on every
  // reload and on every ordinary quit.
  //
  // The handler comes off before the socket is closed, rather than a flag being
  // set and checked, so *this* ordering is not something to get right. (The one
  // that is, `error` before `close`, is handled above.)
  onPageHide(() => {
    socket.off("close", compositorClosed);
    socket.destroy();
  });

  return {
    onData: (listener) => {
      socket.on("data", listener);
    },
    write: (text) => {
      socket.write(text);
    },
  };
};

/**
 * What a dead compositor socket costs the shell.
 *
 * There is nothing to recover to, at connect time or later: the chrome is the
 * compositor's client and has no desktop to draw without it. So it says which
 * socket failed and stops, which is what a program that cannot do its job
 * should do. The message does not claim the socket was unreachable — the same
 * listener catches an `ECONNRESET` from a compositor that died after a good
 * connect, and naming a path that *was* reached would send the reader looking
 * for a missing file.
 */
const lostCompositor =
  (fail: CompositorHost["fail"], path: string) =>
  (failure: Error): void => {
    fail(
      `domicile: the compositor socket at ${path} failed: ${failure.message}\n`,
      1,
    );
  };

/** The real socket, which a test replaces with one it can drive. */
const openSocket = (path: string): CompositorSocket => net.connect(path);
