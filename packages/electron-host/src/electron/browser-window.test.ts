import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import type { Engine, EngineRequest, WindowEvent } from "../engine";
import { electronPaths } from "../paths";
import { createApp } from "./app";
import { createBrowserWindow } from "./browser-window";
import { createIpcMain } from "./ipc-main";

const setUp = () => {
  const sent: EngineRequest[] = [];
  const events: Engine["events"] = new EventEmitter();
  const exits: number[] = [];
  const { app } = createApp({
    appPath: "/cache/x/resources/app.asar",
    exit: (code) => exits.push(code),
    paths: electronPaths({
      env: {},
      execPath: "/bin/bun",
      home: "/home/me",
      productName: "Notes",
      temp: "/tmp",
      userDirs: undefined,
    }),
    pkg: {
      appId: "com.example.Notes",
      main: "/cache/x/resources/app.asar/main.js",
      name: "notes",
      productName: "Notes",
      version: "1.0.0",
    },
  });
  const { ipcMain, ...ipc } = createIpcMain();
  const BrowserWindow = createBrowserWindow(
    { events, send: (request) => sent.push(request) },
    app,
    ipc,
    (path) => `source of ${path}`,
  );
  const say = (event: WindowEvent) => events.emit("window", event);
  return { app, BrowserWindow, exits, ipcMain, say, sent };
};

describe(createBrowserWindow, () => {
  it("opens the window with its first page and loads the next in it", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();

    void window.loadURL("https://notes.test/");
    void window.loadURL("https://notes.test/b");

    expect(sent).toEqual([
      { type: "open_window", url: "https://notes.test/", window: 1 },
      { type: "load_url", url: "https://notes.test/b", window: 1 },
    ]);
  });

  it("numbers windows from 1 and finds them by number", () => {
    const { BrowserWindow } = setUp();
    const first = new BrowserWindow();
    const second = new BrowserWindow();

    expect([first.id, second.id]).toEqual([1, 2]);
    expect(BrowserWindow.fromId(2)).toBe(second);
    expect(BrowserWindow.getAllWindows()).toEqual([first, second]);
  });

  it("loads a file of the app by its path from the app's root", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow().loadFile("dist/index.html");

    expect(sent).toEqual([
      {
        type: "open_window",
        url: "file:///cache/x/resources/app.asar/dist/index.html",
        window: 1,
      },
    ]);
  });

  it("resolves a load once its page loads, and is ready to show", async () => {
    const { BrowserWindow, say } = setUp();
    const window = new BrowserWindow();
    const shown = new Promise((resolve) => window.on("ready-to-show", resolve));
    const finished = new Promise((resolve) =>
      window.webContents.on("did-finish-load", resolve),
    );

    const loading = window.loadURL("https://notes.test/");
    say({ type: "window_loaded", window: 1 });

    await loading;
    await shown;
    await finished;
    expect(window.isVisible()).toBe(true);
  });

  it("rejects a load the engine refused, with why", async () => {
    const { BrowserWindow, say } = setUp();
    const window = new BrowserWindow();

    const loading = window.loadURL("chrome://settings");
    say({ type: "window_refused", why: "no", window: 1 });

    await expect(loading).rejects.toThrow("no");
  });

  it("takes the page's title unless a listener prevents it", () => {
    const { BrowserWindow, say } = setUp();
    const kept = new BrowserWindow({ title: "Mine" });
    const taken = new BrowserWindow();
    kept.on("page-title-updated", (event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );

    say({ title: "Page", type: "title_changed", window: 1 });
    say({ title: "Page", type: "title_changed", window: 2 });

    expect(kept.getTitle()).toBe("Mine");
    expect(taken.getTitle()).toBe("Page");
  });

  it("asks the engine to close an open window, and lets a close listener keep it", () => {
    const { BrowserWindow, sent } = setUp();
    const kept = new BrowserWindow();
    const closed = new BrowserWindow();
    void kept.loadURL("https://a.test/");
    void closed.loadURL("https://b.test/");
    kept.on("close", (event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    sent.length = 0;

    kept.close();
    closed.close();

    expect(sent).toEqual([{ type: "close_window", window: 2 }]);
  });

  it("destroys without asking", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/");
    window.on("close", (event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    sent.length = 0;

    window.destroy();

    expect(sent).toEqual([{ type: "destroy_window", window: 1 }]);
  });

  it("is closed once the engine says so, and the app quits with its last window", () => {
    const { BrowserWindow, exits, say } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/").catch(() => undefined);
    let heard = false;
    window.on("closed", () => {
      heard = true;
    });

    say({ type: "window_closed", window: 1 });

    expect(heard).toBe(true);
    expect(window.isDestroyed()).toBe(true);
    expect(BrowserWindow.getAllWindows()).toEqual([]);
    expect(exits).toEqual([0]);
  });

  it("leaves quitting to an app that listens for window-all-closed", () => {
    const { BrowserWindow, app, exits, say } = setUp();
    let heard = false;
    app.on("window-all-closed", () => {
      heard = true;
    });
    void new BrowserWindow().loadURL("https://a.test/").catch(() => undefined);

    say({ type: "window_closed", window: 1 });

    expect(heard).toBe(true);
    expect(exits).toEqual([]);
  });

  it("closes a window that never opened without the engine", () => {
    const { BrowserWindow, app, sent } = setUp();
    app.on("window-all-closed", () => undefined);
    const window = new BrowserWindow();

    window.close();

    expect(window.isDestroyed()).toBe(true);
    expect(sent).toEqual([]);
  });

  it("refuses to load in a destroyed window, as Electron does", () => {
    const { BrowserWindow, app } = setUp();
    app.on("window-all-closed", () => undefined);
    const window = new BrowserWindow();
    window.destroy();

    expect(() => window.loadURL("https://a.test/")).toThrow(
      "Object has been destroyed",
    );
  });
  it("opens a window with its preload's source", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow({
      webPreferences: { preload: "/app/preload.js" },
    }).loadURL("https://notes.test/");

    expect(sent).toEqual([
      {
        preload: "source of /app/preload.js",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
    ]);
  });

  it("refuses a window whose page needs Node.js", () => {
    const { BrowserWindow } = setUp();

    expect(
      () => new BrowserWindow({ webPreferences: { nodeIntegration: true } }),
    ).toThrow("needs Node.js");
    expect(
      () => new BrowserWindow({ webPreferences: { contextIsolation: false } }),
    ).toThrow("needs Node.js");
  });

  it("gives its page's send to ipcMain, from its webContents", () => {
    const { BrowserWindow, ipcMain, say } = setUp();
    const window = new BrowserWindow();
    const heard: unknown[] = [];
    ipcMain.on("save", (event: { sender: unknown }, ...args: unknown[]) =>
      heard.push(event.sender, ...args),
    );

    say({ args: [1], channel: "save", type: "ipc_message", window: 1 });

    expect(heard).toEqual([window.webContents, 1]);
  });

  it("answers its page's invoke with the handler's result or failure", async () => {
    const { BrowserWindow, ipcMain, say, sent } = setUp();
    void new BrowserWindow();
    ipcMain.handle("double", (_event, n) => Number(n) * 2);
    const answered = new Promise<void>((resolve) => {
      const count = sent.length;
      const check = () =>
        sent.length >= count + 2 ? resolve() : setTimeout(check, 1);
      check();
    });

    say({
      args: [2],
      channel: "double",
      invoke: 1,
      type: "ipc_invoke",
      window: 1,
    });
    say({
      args: [],
      channel: "none",
      invoke: 2,
      type: "ipc_invoke",
      window: 1,
    });
    await answered;

    // Each answers when its handler does, so in either order.
    expect(sent).toHaveLength(2);
    expect(sent).toContainEqual({ invoke: 1, result: 4, type: "ipc_reply" });
    expect(sent).toContainEqual({
      error: "No handler registered for 'none'",
      invoke: 2,
      type: "ipc_reply",
    });
  });

  it("sends to its page as JSON", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/");
    sent.length = 0;

    window.webContents.send("ping", { at: new Date(0) }, undefined);

    expect(sent).toEqual([
      {
        args: [{ at: "1970-01-01T00:00:00.000Z" }, null],
        channel: "ping",
        type: "ipc_send",
        window: 1,
      },
    ]);
  });
});
