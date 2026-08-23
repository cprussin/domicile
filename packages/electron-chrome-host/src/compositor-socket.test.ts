import { describe, expect, it } from "bun:test";

import type { CompositorSocket } from "./compositor-socket";
import { connectToCompositor } from "./compositor-socket";

const SOCKET_PATH = "/run/user/1000/domicile-chrome.sock";

type Failure = [line: string, code: number];

/** What each of the socket's events hands whoever is listening for it. */
type SocketListeners = {
  close: (hadError: boolean) => void;
  data: (chunk: Uint8Array) => void;
  error: (failure: Error) => void;
};

/** A socket the test drives, standing in for `net.connect`'s. */
const fakeSocket = () => {
  const listeners: { [K in keyof SocketListeners]: SocketListeners[K][] } = {
    close: [],
    data: [],
    error: [],
  };
  const written: string[] = [];
  let destroyed = false;
  const socket: CompositorSocket = {
    destroy: () => {
      destroyed = true;
    },
    off: (_event, listener) => {
      listeners.close = listeners.close.filter((held) => held !== listener);
    },
    on: <K extends keyof SocketListeners>(
      event: K,
      listener: SocketListeners[K],
    ) => {
      listeners[event].push(listener);
    },
    write: (text) => {
      written.push(text);
    },
  };
  return {
    closed: (hadError: boolean) => {
      for (const listener of [...listeners.close]) {
        listener(hadError);
      }
    },
    errored: (failure: Error) => {
      for (const listener of [...listeners.error]) {
        listener(failure);
      }
    },
    received: (chunk: Uint8Array) => {
      for (const listener of [...listeners.data]) {
        listener(chunk);
      }
    },
    socket,
    wasDestroyed: () => destroyed,
    written,
  };
};

/** A connection whose socket and page the test holds both ends of. */
const connected = () => {
  const said: Failure[] = [];
  const pageHidden: (() => void)[] = [];
  const fake = fakeSocket();
  const stream = connectToCompositor(
    {
      fail: (line, code) => said.push([line, code]),
      onPageHide: (listener) => pageHidden.push(listener),
      path: SOCKET_PATH,
    },
    () => fake.socket,
  );
  return {
    fake,
    hidePage: () => {
      for (const listener of pageHidden) {
        listener();
      }
    },
    said,
    stream,
  };
};

describe("connectToCompositor", () => {
  describe("the bytes", () => {
    it("carries what the page sends to the socket", () => {
      const { fake, stream } = connected();
      stream.write('{"type":"hello"}\n');
      expect(fake.written).toStrictEqual(['{"type":"hello"}\n']);
    });

    it("hands what the socket says to the page", () => {
      const chunks: Uint8Array[] = [];
      const { fake, stream } = connected();
      stream.onData((chunk) => chunks.push(chunk));
      fake.received(new Uint8Array([1, 2]));
      expect(chunks).toStrictEqual([new Uint8Array([1, 2])]);
    });
  });

  describe("losing the compositor", () => {
    it("names the socket that failed", () => {
      // Node turns an unhandled `'error'` into an uncaught exception, so
      // without a listener the shell dies on a `PipeConnectWrap` stack rather
      // than a sentence about the socket — which is what happened every time it
      // was started without the compositor.
      const { fake, said } = connected();
      fake.errored(new Error("connect ENOENT"));
      expect(said).toStrictEqual([
        [
          `domicile: the compositor socket at ${SOCKET_PATH} failed: connect ENOENT\n`,
          1,
        ],
      ]);
    });

    it("reports a peer that went away without an error", () => {
      // A peer that dies on a Unix stream socket sends a FIN, which Node
      // reports as `end` then `close` and never as an error — so without this
      // the desktop goes on drawing a still of a machine that is gone.
      const { fake, said } = connected();
      fake.closed(false);
      expect(said).toStrictEqual([
        [
          `domicile: the compositor socket at ${SOCKET_PATH} failed: the compositor closed the connection\n`,
          1,
        ],
      ]);
    });

    it("does not speak over the error it already reported", () => {
      // Node emits `close` after *every* `error`, so an unguarded one reports a
      // second time and gets it wrong: a socket that was never there would read
      // as a compositor that closed the connection.
      const { fake, said } = connected();
      fake.errored(new Error("connect ENOENT"));
      fake.closed(true);
      expect(said.length).toBe(1);
    });
  });

  describe("the page going away", () => {
    it("is not a compositor that died", () => {
      // A reload — or the window closing on the way out of the app — tears the
      // preload's Node environment down with the document. Read as a dead
      // compositor it would print a failure and exit non-zero on every reload
      // and on every ordinary quit.
      const { hidePage, fake, said } = connected();
      hidePage();
      fake.closed(false);
      expect(said).toStrictEqual([]);
    });

    it("closes the socket on the way out", () => {
      const { hidePage, fake } = connected();
      hidePage();
      expect(fake.wasDestroyed()).toBe(true);
    });
  });
});
