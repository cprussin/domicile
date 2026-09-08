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

import { statSync } from "node:fs";
import path from "node:path";

import { connect } from "bun";

import { shellDocument } from "./shell-document";
import { fileForRequest } from "./static-path";

/** Where the session is served. The page derives this; nothing configures it. */
export const SESSION_PATH = "/domicile-session";

/**
 * Where a dev-mode page asks whether the shell has been rebuilt.
 *
 * Under `SESSION_PATH`'s prefix rather than a name of its own, so the one
 * thing a shell can never call an asset stays one thing: anything beginning
 * `/domicile-` is the bridge's, and everything else is the shell's.
 */
export const DEV_RELOAD_PATH = "/domicile-dev-reload";

export type ServeOptions = {
  /** The compositor's `--chrome-socket`: the protocol, as a unix stream. */
  socketPath: string;
  /** The shell's built page. Served as-is; nothing is compiled here. */
  root: string;
  /**
   * The shell's module, relative to {@link root}, when it has one.
   *
   * With it, `/` is a document written to load that module — see
   * `shell-document.ts` for why Domicile owns that document. Without it, `/`
   * is `index.html` under {@link root}, which is what a shell built from an
   * HTML entry still produces.
   *
   * Everything else is served from {@link root} either way, this module
   * included: naming it does not change where it is read from.
   */
  module?: string;
  /**
   * Serve the reload token, and put the poller that reads it in the document.
   *
   * Dev only, and off unless asked: a desktop runs under `--app`, which has no
   * reload in it, so without this a one-character change to a shell means
   * killing the desktop and starting it again. `scripts/dev-shell.sh` is what
   * turns it on; an installed desktop never does.
   */
  reload?: boolean;
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
  const module = options.module;
  const socketPath = options.socketPath;
  const reachForMs = options.reachForMs ?? REACH_FOR_MS;
  const reload = options.reload ?? false;

  const server = Bun.serve<{ pending: (string | Uint8Array)[] }>({
    fetch: async (request, self) => {
      const url = new URL(request.url);
      if (url.pathname === SESSION_PATH) {
        // ONLY THE PAGE THIS BRIDGE IS SERVING, and this is not a nicety.
        //
        // What is on the other side of this upgrade is a byte pipe to the
        // compositor's control socket, and that protocol carries `spawn` —
        // arbitrary commands, on the machine running the desktop. The bridge
        // listens on a TCP port because a page cannot open a unix socket and
        // `file:` has no origin to derive one from; a loopback port is
        // reachable by every process on the machine *and* by any page in any
        // browser on it.
        //
        // A WebSocket is not stopped by CORS. The browser sends `Origin` and
        // the server is what has to refuse it, so without this check any
        // website the user visits could scan a few thousand ephemeral ports,
        // find this one, and run whatever it liked. Measured before it was
        // fixed: an upgrade carrying `Origin: https://evil.example` was
        // accepted, and `{"type":"spawn","command":["xcalc"]}` reached the
        // compositor socket unaltered.
        //
        // WHAT THIS DOES NOT STOP, said plainly rather than left to be
        // discovered: another *local* process. `curl` sets any header it
        // likes, so an origin proves a browser's caller and nothing else. The
        // fix for that is not a token — the page has to read one, and anything
        // local can read the page — it is not using a TCP port at all, which
        // the fork could arrange with a scheme of its own. That is real work
        // and it is not this. This closes the drive-by, which is the half a
        // stranger can reach.
        const origin = request.headers.get("origin");
        if (origin !== null && origin !== ourOrigin(self)) {
          return new Response("not this desktop's page", { status: 403 });
        }
        return self.upgrade(request, { data: { pending: [] } })
          ? undefined
          : new Response("this path is a websocket", { status: 426 });
      }
      // Dev mode's whole server side: what the page compares against what it
      // saw last. Before `fileForRequest`, because this path is the bridge's
      // and must not be answerable by a file a shell happens to have built.
      if (reload && url.pathname === DEV_RELOAD_PATH) {
        return new Response(buildToken(root, module), {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }
      const file = fileForRequest(root, url.pathname);
      if (file === undefined) {
        return new Response("not found", { status: 404 });
      }
      // The document, before anything is read off disk. A shell that is a
      // module ships no `index.html` — there is nothing on disk to serve here
      // — and one built from an HTML entry falls through to the file, which is
      // what the workspace shells still have.
      //
      // Decided from the *resolved* path rather than from the request's own
      // spelling, and that is the whole of this: `fileForRequest` decodes and
      // normalises, so a guard that compared `url.pathname` against `"/"` and
      // `"/index.html"` disagreed with it about every other way to write the
      // same file. `GET //`, `GET /.//` and `GET /%69ndex.html` all missed the
      // guard, fell through, and served the shell's own `index.html` —
      // defeating, with one character, the property this exists for. Measured
      // over a raw socket, because `fetch` and `URL` normalise `//` away
      // before a server ever sees it.
      if (module !== undefined && file === documentIn(root)) {
        return new Response(
          shellDocument(module, reload ? DEV_RELOAD_PATH : undefined),
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
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

/**
 * The origin this bridge serves its own page on.
 *
 * Asked of the running server rather than built from the options, because the
 * port is the kernel's: `port: 0` is how this avoids colliding with whatever
 * else is on the machine, so nothing knows the number until it is listening.
 *
 * A page served from here sends exactly this in `Origin`, and every other page
 * in the world sends something else.
 */
const ourOrigin = (server: {
  hostname: string | undefined;
  port: number | undefined;
}): string => `http://${server.hostname ?? ""}:${String(server.port ?? "")}`;

/**
 * The one file a request has to resolve to for Domicile to write the page.
 *
 * `index.html` in the root, because that is what `fileForRequest` resolves
 * both `/` and `/index.html` to — the second being what a browser resolves a
 * bookmark or a reload to, so a 404 for it would be a page that works until
 * somebody presses enter in an address bar.
 *
 * Asked of the same function that finds every other file, so the two cannot
 * disagree about what a path means. They did: see the comment at the call
 * site.
 */
const documentIn = (root: string): string =>
  path.join(path.resolve(root), "index.html");

/**
 * What the shell's build looks like right now, in one line.
 *
 * Size and modification time of the file the page loads, which is what a
 * rebuild changes. Not a hash of the bytes: this is asked twice a second for
 * as long as a desktop is open, and reading a megabyte of bundle to answer it
 * would be the most expensive thing this process does.
 *
 * A module is the thing that changed when a shell is a module; a shell built
 * from an HTML entry has its document rebuilt instead, so that is what is
 * watched there. Either way it is one file, and a build that writes it last —
 * which is what a bundler does, since the entry point names the rest.
 *
 * A file that is missing answers rather than throwing: a `--watch` build
 * rewrites its output, and a poll landing in the middle of that must not take
 * the page down. `gone` is a token like any other, so the reload happens on
 * the next poll, when it is back.
 */
const buildToken = (root: string, module: string | undefined): string => {
  const file =
    module === undefined ? documentIn(root) : path.join(root, module);
  try {
    const { mtimeMs, size } = statSync(file);
    return `${String(mtimeMs)}:${String(size)}`;
  } catch {
    return "gone";
  }
};
