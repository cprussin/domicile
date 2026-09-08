import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEV_RELOAD_PATH, SESSION_PATH, serveShell } from "./serve-shell";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/** A stand-in compositor: a unix socket that records and can talk back. */
const compositor = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "domicile-bridge-"));
  const socketPath = path.join(dir, "chrome.sock");
  const heard: string[] = [];
  let talk: ((text: string) => void) | undefined;
  const server = net.createServer((socket) => {
    socket.on("data", (chunk: Buffer) => heard.push(chunk.toString("utf8")));
    socket.on("error", () => undefined);
    talk = (text) => socket.write(text);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(async () => {
    server.close();
    await rm(dir, { force: true, recursive: true });
  });
  return {
    dir,
    heard,
    say: (text: string) => talk?.(text),
    socketPath,
    spoken: () => talk !== undefined,
  };
};

const opened = async (url: string) => {
  const socket = new WebSocket(url);
  const messages: string[] = [];
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event: MessageEvent) => {
    messages.push(new TextDecoder().decode(event.data as ArrayBuffer));
  });
  await new Promise<void>((resolve) =>
    socket.addEventListener("open", () => resolve()),
  );
  cleanups.push(() => socket.close());
  return { messages, socket };
};

const eventually = async (until: () => boolean) => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (until()) {
      return true;
    }
    await Bun.sleep(10);
  }
  return false;
};

/**
 * One HTTP GET, written on the socket exactly as given.
 *
 * `fetch` normalises a path before it sends it — `//` becomes `/`, `%69`
 * becomes `i` — so it cannot ask a server the questions above. This spells the
 * request line itself and reads the whole response back.
 */
const rawGet = (port: number, pathname: string): Promise<string> =>
  new Promise((done, fail) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("end", () => done(received));
    socket.on("error", fail);
  });

describe("serveShell", () => {
  it("serves the shell's page at the root", async () => {
    const host = await compositor();
    await writeFile(
      path.join(host.dir, "index.html"),
      "<title>a shell</title>",
    );
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    const response = await fetch(serving.url);

    expect(await response.text()).toBe("<title>a shell</title>");
  });

  // WITH A MANIFEST THERE IS NO index.html TO SERVE, and that is the point: a
  // shell ships JavaScript and CSS, and the document it loads in is written
  // here so that no shell can get it wrong. See `shell-document.ts`.
  it("writes the document when the shell is a module", async () => {
    const host = await compositor();
    const serving = serveShell({
      module: "shell.js",
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const response = await fetch(serving.url);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain('<script src="shell.js" type="module">');
    expect(body).toContain("<title>Domicile</title>");
  });

  // ---- dev mode ----------------------------------------------------------
  //
  // A desktop runs under `--app`, which drops the browser's keyboard
  // shortcuts, so there is no reload in it. Without this a one-character
  // change to a shell means killing the desktop and starting it again.

  it("serves no reload token unless it was asked to", async () => {
    const host = await compositor();
    await writeFile(path.join(host.dir, "shell.js"), "export const x = 1;");
    const serving = serveShell({
      module: "shell.js",
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const response = await fetch(
      `${serving.url.slice(0, -1)}${DEV_RELOAD_PATH}`,
    );

    // 404 rather than a token: an installed desktop is not a dev server, and
    // the poller is not in its page either.
    expect(response.status).toBe(404);
    expect(await (await fetch(serving.url)).text()).not.toContain(
      DEV_RELOAD_PATH,
    );
  });

  it("puts the poller in the document when asked", async () => {
    const host = await compositor();
    await writeFile(path.join(host.dir, "shell.js"), "export const x = 1;");
    const serving = serveShell({
      module: "shell.js",
      reload: true,
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const body = await (await fetch(serving.url)).text();

    expect(body).toContain(DEV_RELOAD_PATH);
    // Still the shell's own document in every other respect.
    expect(body).toContain('<script src="shell.js" type="module">');
  });

  // THE ASSERTION THE WHOLE THING RESTS ON. A token that does not move when
  // the shell is rebuilt is a dev mode that never reloads, and it would look
  // exactly like a working one until somebody edited a file.
  it("changes the token when the shell is rebuilt", async () => {
    const host = await compositor();
    const module = path.join(host.dir, "shell.js");
    await writeFile(module, "export const x = 1;");
    const serving = serveShell({
      module: "shell.js",
      reload: true,
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());
    const token = `${serving.url.slice(0, -1)}${DEV_RELOAD_PATH}`;

    const before = await (await fetch(token)).text();
    // Longer, so the answer moves even where the filesystem's timestamps are
    // coarse. A rebuild that happens to produce the same size within the same
    // millisecond is the one case this cannot see, and a bundler writing the
    // same bytes is a rebuild with nothing to reload for.
    await writeFile(module, "export const x = 2; // rebuilt\n");
    const after = await (await fetch(token)).text();

    expect(before).not.toBe(after);
    expect(await (await fetch(token)).text()).toBe(after);
  });

  // A `--watch` build rewrites its output, so a poll can land while the file
  // is not there. That must not take the page down: it answers, and the next
  // poll is the reload.
  it("answers when the module is momentarily gone", async () => {
    const host = await compositor();
    const serving = serveShell({
      module: "shell.js",
      reload: true,
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const response = await fetch(
      `${serving.url.slice(0, -1)}${DEV_RELOAD_PATH}`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("gone");
  });

  // A reload or a bookmark resolves to `/index.html`, so serving a 404 there
  // would be a desktop that works until somebody presses enter in an address
  // bar — and a shell that is a module ships no such file to fall back on.
  it("writes the document for /index.html too", async () => {
    const host = await compositor();
    const serving = serveShell({
      module: "shell.js",
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const response = await fetch(`${serving.url}index.html`);

    expect(await response.text()).toContain('<script src="shell.js"');
  });

  // EVERY OTHER WAY TO SPELL THE SAME FILE, which is where this was wrong.
  //
  // The guard used to compare the raw `url.pathname` against `"/"` and
  // `"/index.html"` while `fileForRequest` decoded and normalised — so three
  // spellings that resolve to exactly the same file missed the guard, fell
  // through to disk, and served the shell's own `index.html`. That is the one
  // property this whole design exists for ("there is no way to supply a
  // document of your own") defeated by one character.
  //
  // Over a raw socket, and that is not incidental: `fetch` collapses these
  // before a server ever sees them, so a test written with `fetch` cannot
  // reach this bug at all. It has to be spoken on the wire.
  //
  // These three and not a fourth. `/./index.html` looks like it belongs and
  // does not: WHATWG URL parsing removes single-dot segments, so `new
  // URL(request.url).pathname` hands the server `/index.html` and the old
  // guard matched it. Measured — it passed against the broken code, which
  // makes it a case that proves nothing. What survives URL parsing is an
  // *empty* segment (`//` stays `//`, and `/.//` becomes it) and a
  // percent-escape (`%69` is never decoded there). Those are the ways in.
  it.each(["//", "/.//", "/%69ndex.html"])(
    "writes the document for %s, which is the same file",
    async (spelling) => {
      const host = await compositor();
      // An index.html on disk to be served *instead*, which is what makes this
      // a real test: without one, falling through reaches a 404 and the wrong
      // behaviour looks like the right one.
      await writeFile(
        path.join(host.dir, "index.html"),
        "<title>THE SHELL'S OWN</title>",
      );
      const serving = serveShell({
        module: "shell.js",
        root: host.dir,
        socketPath: host.socketPath,
      });
      cleanups.push(() => serving.stop());

      const body = await rawGet(Number(new URL(serving.url).port), spelling);

      expect(body).toContain('<script src="shell.js"');
      expect(body).not.toContain("THE SHELL'S OWN");
    },
  );

  // The module itself is still read off disk, along with whatever it imports:
  // naming it does not change where it is served from.
  it("still serves the files the document names", async () => {
    const host = await compositor();
    await writeFile(path.join(host.dir, "shell.js"), "export const x = 1;");
    const serving = serveShell({
      module: "shell.js",
      root: host.dir,
      socketPath: host.socketPath,
    });
    cleanups.push(() => serving.stop());

    const response = await fetch(`${serving.url}shell.js`);

    expect(await response.text()).toBe("export const x = 1;");
  });

  // A shell that is not a module is one built from an HTML entry, which is
  // what the workspace's own two still do. Nothing about them changes yet.
  it("serves the file when the shell is not a module", async () => {
    const host = await compositor();
    await writeFile(
      path.join(host.dir, "index.html"),
      "<title>on disk</title>",
    );
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    expect(await (await fetch(serving.url)).text()).toBe(
      "<title>on disk</title>",
    );
  });

  it("answers 404 for a path outside the root", async () => {
    const host = await compositor();
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    const response = await fetch(
      `${serving.url}%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
    );

    expect(response.status).toBe(404);
  });

  // The pipe, in the direction that matters most: the compositor is already
  // talking when the page connects.
  it("carries the compositor's bytes to the page", async () => {
    const host = await compositor();
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    const page = await opened(
      `${serving.url.replace("http:", "ws:")}${SESSION_PATH.slice(1)}`,
    );
    expect(await eventually(() => host.spoken())).toBeTrue();
    host.say('{"type":"welcome"}\n');

    expect(await eventually(() => page.messages.length > 0)).toBeTrue();
    expect(page.messages.join("")).toBe('{"type":"welcome"}\n');
  });

  it("carries the page's bytes to the compositor", async () => {
    const host = await compositor();
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    const page = await opened(
      `${serving.url.replace("http:", "ws:")}${SESSION_PATH.slice(1)}`,
    );
    page.socket.send('{"type":"hello"}\n');

    expect(await eventually(() => host.heard.length > 0)).toBeTrue();
    expect(host.heard.join("")).toBe('{"type":"hello"}\n');
  });

  // A shell's first act is the handshake and it makes it as soon as its bundle
  // runs, which can be before this end has finished connecting to the
  // compositor. Dropping it would hang the desktop on a handshake that was
  // never sent.
  it("holds what the page sends before the compositor is connected", async () => {
    const host = await compositor();
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());

    const socket = new WebSocket(
      `${serving.url.replace("http:", "ws:")}${SESSION_PATH.slice(1)}`,
    );
    cleanups.push(() => socket.close());
    // Sent on `open`, which is the earliest a page can speak and is before the
    // unix socket behind it can plausibly have connected.
    socket.addEventListener("open", () => socket.send('{"type":"hello"}\n'));

    expect(await eventually(() => host.heard.length > 0)).toBeTrue();
    expect(host.heard.join("")).toBe('{"type":"hello"}\n');
  });
});

describe("serveShell, and who may drive the compositor", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  /**
   * Try the upgrade with the origin `chosen` names, and say whether it was
   * allowed.
   *
   * `chosen` is given the bridge's *own* origin, because the port is the
   * kernel's — nothing knows it until the server is listening, so a test that
   * wants to send the legitimate one has to be handed it here.
   */
  const upgradeFrom = async (
    chosen: (ours: string) => string | undefined,
  ): Promise<boolean> => {
    const host = await compositor();
    const serving = serveShell({ root: host.dir, socketPath: host.socketPath });
    cleanups.push(() => serving.stop());
    const where = new URL(serving.url).origin;
    const origin = chosen(where);
    const response = await fetch(`${where}${SESSION_PATH}`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        ...(origin === undefined ? {} : { origin }),
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    return response.status !== 403;
  };

  // WHAT IS ON THE OTHER SIDE OF THIS is a byte pipe to the compositor's
  // control socket, and that protocol carries `spawn` — arbitrary commands on
  // the machine running the desktop — plus synthetic input into any window and
  // every window's title as it changes.
  //
  // The bridge listens on a TCP port because a page cannot open a unix socket,
  // and a loopback port is reachable by any page in any browser on the machine.
  // A WebSocket is not stopped by CORS: the browser sends `Origin` and the
  // server has to refuse it. Measured before this existed — an upgrade carrying
  // `Origin: https://evil.example` was accepted and a `spawn` reached the
  // compositor socket unaltered.
  it("refuses an upgrade from a page it did not serve", async () => {
    expect(await upgradeFrom(() => "https://evil.example")).toBeFalse();
  });

  // `null` is what a sandboxed iframe and a `file:` page send. Neither is the
  // desktop's page, and "null" is not a name anything can be trusted by.
  it("refuses a null origin", async () => {
    expect(await upgradeFrom(() => "null")).toBeFalse();
  });

  it("allows the page it is serving", async () => {
    // The one that has to keep working: this is the desktop connecting to its
    // own compositor, and a check that refused it would be a desktop that
    // never starts.
    expect(await upgradeFrom((ours) => ours)).toBeTrue();
  });

  // DELIBERATE, and worth stating because it looks like a hole. A browser
  // always sends `Origin` on a WebSocket handshake, so nothing reachable from
  // a web page arrives without one — this cannot be the drive-by. What it
  // admits is a local non-browser client, which could set any origin it liked
  // anyway: `curl` forges a header in one flag, so refusing here would cost
  // honest tooling and stop no attacker. The line this check draws is against
  // *pages*, and it says so.
  it("allows a client that sends no origin at all", async () => {
    expect(await upgradeFrom(() => undefined)).toBeTrue();
  });
});

describe("serveShell, before the compositor exists", () => {
  // The launch order forces this. The browser has to be running before the
  // compositor can connect to it as a producer, so the page — and this
  // websocket — is up while the compositor is still starting. Closing on the
  // first ENOENT would hand every shell a dead transport on every launch.
  it("waits for a compositor that is not listening yet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "domicile-bridge-late-"));
    const socketPath = path.join(dir, "chrome.sock");
    cleanups.push(() => rm(dir, { force: true, recursive: true }));

    const serving = serveShell({ root: dir, socketPath });
    cleanups.push(() => serving.stop());

    const socket = new WebSocket(
      `${serving.url.replace("http:", "ws:")}${SESSION_PATH.slice(1)}`,
    );
    cleanups.push(() => socket.close());
    const closed: boolean[] = [];
    socket.addEventListener("close", () => closed.push(true));
    socket.addEventListener("open", () => socket.send('{"type":"hello"}\n'));
    await Bun.sleep(150);
    expect(closed).toEqual([]);

    // Now the compositor turns up, as it does a second or so into a launch.
    const heard: string[] = [];
    const late = net.createServer((connection) => {
      connection.on("data", (chunk: Buffer) => heard.push(chunk.toString()));
      connection.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => late.listen(socketPath, resolve));
    cleanups.push(() => {
      late.close();
    });

    // And what the page said while it was missing arrives, rather than being
    // dropped: that message is the handshake.
    expect(await eventually(() => heard.length > 0)).toBeTrue();
    expect(heard.join("")).toBe('{"type":"hello"}\n');
  });

  // The wait is bounded, and how long it is bounded for is the caller's: the
  // gap it has to cover is the compositor starting, and on a CI runner that is
  // minutes rather than the seconds a desktop takes. A session that gave up
  // early leaves the page with a dead transport, which reads as a shell that
  // never joined rather than as a budget that was too short.
  it("gives up on a compositor that is never going to exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "domicile-bridge-budget-"));
    const socketPath = path.join(dir, "never.sock");
    cleanups.push(() => rm(dir, { force: true, recursive: true }));

    const serving = serveShell({ reachForMs: 200, root: dir, socketPath });
    cleanups.push(() => serving.stop());

    const socket = new WebSocket(
      `${serving.url.replace("http:", "ws:")}${SESSION_PATH.slice(1)}`,
    );
    cleanups.push(() => socket.close());
    const closed: boolean[] = [];
    socket.addEventListener("close", () => closed.push(true));

    // Nothing is ever going to listen on that path, so the only thing that
    // ends this is the budget running out. That it is *this* budget and not
    // the default is what the short one buys: the default is thirty seconds
    // and this test does not take thirty seconds.
    //
    // The lower bound is not asserted, and the seam to assert it on does not
    // exist — `reach` takes an injectable clock but `serveShell` does not pass
    // one through. Worth having when something depends on the wait being at
    // least as long as it was asked for; nothing does yet.
    expect(await eventually(() => closed.length > 0)).toBeTrue();
  });
});
