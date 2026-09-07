import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { SESSION_PATH, serveShell } from "./serve-shell";

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
});
