// The one process Electron leaves behind.
//
// A shell's page needs two things the fork cannot give it: the page itself,
// from an origin (a `file:` page has none, and the session URL is derived from
// the page's own), and a connection to the compositor's protocol socket, which
// a page cannot open. This serves both, from one port, so that
// `connectToHost` has nothing to be told.
//
// It is a byte pipe and not a participant. It does not parse the protocol, it
// does not know a `welcome` from an `app_appeared`, and it holds no state about
// the desktop. See `@domicile/chrome-sdk/websocket-transport` for why: a bridge
// that parses is a bridge that can corrupt, and the framing already has a
// tested implementation at the end that needs it.

import { connect } from "bun";

import { fileForRequest } from "./static-path";

/** Where the session is served. The page derives this; nothing configures it. */
export const SESSION_PATH = "/domicile-session";

export type ServeOptions = {
  /** The compositor's `--chrome-socket`: the protocol, as a unix stream. */
  socketPath: string;
  /** The shell's built page. Served as-is; nothing is compiled here. */
  root: string;
  /** 0, the default, asks the kernel for one and reports what it gave. */
  port?: number;
  /**
   * Loopback by default, and that is a security boundary rather than a
   * default. This port is an unauthenticated pipe to the compositor: anything
   * that can open it can drive the desktop. Binding it to an interface a
   * network can reach hands that to the network.
   */
  hostname?: string;
};

export type Serving = {
  /** What to point a browser at. */
  readonly url: string;
  stop: () => void;
};

/** Serve `root` and the compositor's session on one port. */
export const serveShell = (options: ServeOptions): Serving => {
  const root = options.root;
  const socketPath = options.socketPath;

  const server = Bun.serve<{ pending: (string | Uint8Array)[] }>({
    fetch: async (request, self) => {
      const url = new URL(request.url);
      if (url.pathname === SESSION_PATH) {
        return self.upgrade(request, { data: { pending: [] } })
          ? undefined
          : new Response("this path is a websocket", { status: 426 });
      }
      const file = fileForRequest(root, url.pathname);
      if (file === undefined) {
        return new Response("not found", { status: 404 });
      }
      // Checked rather than streamed hopefully. `new Response(Bun.file(...))`
      // for a file that is not there fails while the body is being written,
      // which the client sees as the connection dropping — and a shell asking
      // for an asset it did not build should get a 404 it can read, not a
      // reset it has to guess at.
      const body = Bun.file(file);
      return (await body.exists())
        ? new Response(body)
        : new Response("not found", { status: 404 });
    },
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    websocket: {
      close: (ws) => {
        sockets.get(ws)?.end();
        sockets.delete(ws);
      },
      message: (ws, message) => {
        const socket = sockets.get(ws);
        // The page can speak before the unix socket has finished connecting —
        // a shell's first act is the handshake — so what it says is held
        // rather than dropped. The page's own transport holds too; this is the
        // same gap one hop further along.
        if (socket === undefined) {
          ws.data.pending.push(message);
        } else {
          socket.write(message);
        }
      },
      open: (ws) => {
        void connect({
          socket: {
            close: () => ws.close(),
            data: (_socket, chunk) => {
              // Binary, so the bytes reach the page as the bytes that arrived.
              ws.send(chunk);
            },
            // The compositor going away is the desktop going away. Closing the
            // websocket is how the page finds out; it is not this process's
            // place to decide what that means.
            error: () => ws.close(),
            open: (socket) => {
              sockets.set(ws, socket);
              for (const held of ws.data.pending.splice(0)) {
                socket.write(held);
              }
            },
          },
          unix: socketPath,
        }).catch(() => {
          ws.close();
        });
      },
    },
  });

  return {
    stop: () => {
      server.stop(true);
    },
    url: `http://${server.hostname}:${String(server.port)}/`,
  };
};

/**
 * Which unix socket each open websocket is bridged to.
 *
 * Outside the server rather than in `ws.data` because the socket is not known
 * until `connect` resolves, and `ws.data` is fixed at upgrade.
 */
const sockets = new WeakMap<
  { close: () => void; data: { pending: (string | Uint8Array)[] } },
  { end: () => void; write: (data: string | Uint8Array) => void }
>();
