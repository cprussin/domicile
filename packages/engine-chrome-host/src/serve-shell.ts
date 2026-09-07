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
  /**
   * How long a page's session waits for a compositor that is not there yet,
   * in milliseconds. See {@link REACH_FOR_MS} for why waiting at all is the
   * normal case.
   *
   * Configurable for one reason: the budget has to cover the gap between the
   * page loading and the compositor starting, and on a CI runner building a
   * debug Chromium that gap is minutes rather than seconds. A guard that ran
   * out would report "the shell never joined the compositor", which is not
   * the thing it is guarding.
   */
  reachForMs?: number;
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
  const reachForMs = options.reachForMs ?? REACH_FOR_MS;

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
        void reach(ws, socketPath, reachForMs);
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
 * How long to keep trying the compositor's socket before giving up on it.
 *
 * **The socket is expected to be missing at first, and that is the launch
 * order rather than a fault.** The browser has to be running before the
 * compositor can connect to it as a producer, so the page is loaded — and this
 * websocket opened — while the compositor is still starting. Closing on the
 * first ENOENT would hand every shell a dead transport on every launch.
 *
 * Bounded, because a page that will never have a compositor should say so
 * rather than sit there: the websocket closes and the shell finds out.
 */
const REACH_FOR_MS = 30_000;
const RETRY_EVERY_MS = 50;

/**
 * Connect `ws` to the compositor, waiting for it to exist.
 *
 * Anything the page said while this was trying is written the moment it
 * lands, in order, out of the queue `message` filled.
 */
const reach = async (
  ws: BridgedSocket,
  socketPath: string,
  reachForMs: number,
  now: () => number = Date.now,
): Promise<void> => {
  const until = now() + reachForMs;
  for (;;) {
    try {
      await connect({
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
      });
      return;
    } catch (failure) {
      if (now() >= until) {
        // Said rather than swallowed: a shell whose page has no transport
        // looks like a shell with no windows, and the reason is here.
        // biome-ignore lint/suspicious/noConsole: its only channel, and silence is the failure it reports
        console.error(
          `domicile: no compositor on ${socketPath} after ${String(
            reachForMs,
          )}ms:`,
          failure,
        );
        ws.close();
        return;
      }
      await Bun.sleep(RETRY_EVERY_MS);
    }
  }
};

/** As much of a served websocket as the bridge holds on to. */
type BridgedSocket = {
  close: () => void;
  data: { pending: (string | Uint8Array)[] };
  send: (data: Uint8Array) => void;
};

/**
 * Which unix socket each open websocket is bridged to.
 *
 * Outside the server rather than in `ws.data` because the socket is not known
 * until `connect` resolves, and `ws.data` is fixed at upgrade.
 */
const sockets = new WeakMap<
  BridgedSocket,
  { end: () => void; write: (data: string | Uint8Array) => void }
>();
