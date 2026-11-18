import { describe, expect, it } from "bun:test";
import type { EngineRequest } from "../engine";
import { createBrowserWindow } from "./browser-window";
import { setUp } from "./browser-window-fixture";
import type { MenuEntry } from "./menu";
import type { MessagePortMain } from "./message-port-main";
import { MessageChannelMain } from "./message-port-main";

describe(createBrowserWindow, () => {
  it("opens a window in the app's own session unless it names another", () => {
    const { BrowserWindow, sent, sessions } = setUp();
    const own = new BrowserWindow();
    const named = new BrowserWindow({
      webPreferences: { partition: "persist:cowork" },
    });
    const given = new BrowserWindow({
      webPreferences: { session: sessions.fromPartition("persist:cowork") },
    });

    void own.loadURL("https://notes.test/");
    void named.loadURL("https://notes.test/");
    void given.loadURL("https://notes.test/");

    expect(own.webContents.session).toBe(sessions.defaultSession);
    expect(named.webContents.session).toBe(
      sessions.fromPartition("persist:cowork"),
    );
    expect(given.webContents.session).toBe(named.webContents.session);
    expect(sent).toEqual([
      { scheme: "file", session: "persist:cowork", type: "handle_protocol" },
      {
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
      {
        session: "persist:cowork",
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 2,
      },
      {
        session: "persist:cowork",
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 3,
      },
    ]);
  });

  it("opens the window with its first page and loads the next in it", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();

    void window.loadURL("https://notes.test/");
    void window.loadURL("https://notes.test/b");

    expect(sent).toEqual([
      {
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
      { type: "load_url", url: "https://notes.test/b", window: 1 },
    ]);
  });

  it("has Electron's older history methods, as its navigationHistory", () => {
    const { BrowserWindow } = setUp();
    const { webContents } = new BrowserWindow();

    expect(webContents.canGoBack()).toBe(
      webContents.navigationHistory.canGoBack(),
    );
    expect(webContents.canGoForward()).toBe(
      webContents.navigationHistory.canGoForward(),
    );
    expect(webContents.canGoToOffset(-1)).toBe(
      webContents.navigationHistory.canGoToOffset(-1),
    );
    expect(webContents.goBack).toBe(webContents.navigationHistory.goBack);
    expect(webContents.goForward).toBe(webContents.navigationHistory.goForward);
    expect(webContents.goToIndex).toBe(webContents.navigationHistory.goToIndex);
    expect(webContents.goToOffset).toBe(
      webContents.navigationHistory.goToOffset,
    );
    expect(webContents.clearHistory).toBe(webContents.navigationHistory.clear);
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
        title: "Notes",
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

  it("tells the app of each page as it makes it, as Electron's web-contents-created", () => {
    const { app, BrowserWindow, WebContentsView } = setUp();
    const created: unknown[] = [];
    app.on("web-contents-created", (event, webContents) => {
      created.push(event.sender, webContents);
    });

    const window = new BrowserWindow();
    const view = new WebContentsView();

    expect(created).toEqual([
      window.webContents,
      window.webContents,
      view.webContents,
      view.webContents,
    ]);
  });

  it("is dom-ready when the engine says its DOM is, before it finishes loading", async () => {
    const { BrowserWindow, say } = setUp();
    const window = new BrowserWindow();
    const heard: string[] = [];
    window.webContents.on("dom-ready", () => heard.push("dom-ready"));
    window.webContents.on("did-finish-load", () =>
      heard.push("did-finish-load"),
    );

    const loading = window.loadURL("https://notes.test/");
    say({ type: "window_dom_ready", window: 1 });
    expect(heard).toEqual(["dom-ready"]);
    say({ type: "window_loaded", window: 1 });
    await loading;

    expect(heard).toEqual(["dom-ready", "did-finish-load"]);
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

  it("tells the engine the title the window shows, its own over its page's", () => {
    const { BrowserWindow, say, sent } = setUp();
    const kept = new BrowserWindow({ title: "Mine" });
    const taken = new BrowserWindow();
    kept.on("page-title-updated", (event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    void kept.loadURL("https://a.test/");
    void taken.loadURL("https://b.test/");

    say({ title: "Page", type: "title_changed", window: 1 });
    say({ title: "Page", type: "title_changed", window: 2 });
    kept.setTitle("Still mine");

    expect(sent).toEqual([
      {
        title: "Mine",
        type: "open_window",
        url: "https://a.test/",
        window: 1,
      },
      {
        title: "Notes",
        type: "open_window",
        url: "https://b.test/",
        window: 2,
      },
      { title: "Page", type: "set_title", window: 2 },
      { title: "Still mine", type: "set_title", window: 1 },
    ]);
  });

  it("puts the user's close to the app's close listeners", () => {
    const { BrowserWindow, say, sent } = setUp();
    const kept = new BrowserWindow();
    const closed = new BrowserWindow();
    void kept.loadURL("https://a.test/");
    void closed.loadURL("https://b.test/");
    kept.on("close", (event: { preventDefault: () => void }) => {
      event.preventDefault();
      kept.hide();
    });
    sent.length = 0;

    say({ type: "close_asked", window: 1 });
    say({ type: "close_asked", window: 2 });

    expect(sent).toEqual([
      { hidden: true, type: "set_hidden", window: 1 },
      { type: "close_window", window: 2 },
    ]);
    expect(kept.isDestroyed()).toBe(false);
  });

  it("hides and shows a window, which opens hidden with show: false", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow({ show: false });
    const heard: string[] = [];
    window.on("show", () => heard.push("show"));
    window.on("hide", () => heard.push("hide"));
    void window.loadURL("https://a.test/");
    say({ type: "window_loaded", window: 1 });

    expect(window.isVisible()).toBe(false);
    window.show();
    expect(window.isVisible()).toBe(true);
    window.show();
    window.hide();
    window.hide();
    expect(window.isVisible()).toBe(false);
    window.showInactive();

    expect(sent).toEqual([
      {
        hidden: true,
        title: "Notes",
        type: "open_window",
        url: "https://a.test/",
        window: 1,
      },
      { hidden: false, type: "set_hidden", window: 1 },
      { type: "focus_window", window: 1 },
      { type: "focus_window", window: 1 },
      { hidden: true, type: "set_hidden", window: 1 },
      { hidden: false, type: "set_hidden", window: 1 },
    ]);
    expect(heard).toEqual(["show", "hide", "show"]);
  });

  it("hides a window not yet open by opening it hidden", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();

    window.hide();
    void window.loadURL("https://a.test/");

    expect(sent).toEqual([
      {
        hidden: true,
        title: "Notes",
        type: "open_window",
        url: "https://a.test/",
        window: 1,
      },
    ]);
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
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
    ]);
  });

  it("gives a window's page its additionalArguments", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow({
      webPreferences: {
        additionalArguments: ["--desktop-features={}", "--x"],
        preload: "/app/preload.js",
      },
    }).loadURL("https://notes.test/");
    void new BrowserWindow({
      webPreferences: { additionalArguments: [] },
    }).loadURL("https://notes.test/");

    expect(sent[0]).toMatchObject({
      arguments: ["--desktop-features={}", "--x"],
      type: "open_window",
    });
    expect(sent[1]).not.toHaveProperty("arguments");
  });

  it("opens a window with nodeIntegration with Node.js in its page", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow({
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        preload: "/app/preload.js",
      },
    }).loadURL("https://notes.test/");

    expect(sent).toEqual([
      {
        node: {
          app_path: "/cache/x/resources/app.asar",
          context_isolation: false,
          env: { HOME: "/home/me" },
          integration: true,
          preload: "/app/preload.js",
        },
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
    ]);
  });

  it("gives an unsandboxed window's preload Node.js, isolated", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow({
      webPreferences: { preload: "/app/preload.js", sandbox: false },
    }).loadURL("https://notes.test/");

    expect(sent).toMatchObject([
      {
        node: {
          context_isolation: true,
          integration: false,
          preload: "/app/preload.js",
        },
        type: "open_window",
      },
    ]);
    expect(sent[0]).not.toHaveProperty("preload");
  });

  it("keeps a sandboxed window sandboxed, nodeIntegration or not", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow({
      webPreferences: { nodeIntegration: true, sandbox: true },
    }).loadURL("https://notes.test/");

    expect(sent[0]).not.toHaveProperty("node");
  });

  it("hands a sandboxed preload in the page's own world to its refuse", () => {
    const refused: string[] = [];
    const { BrowserWindow } = setUp({
      refuse: (why) => {
        refused.push(why);
        throw new Error("refused");
      },
    });

    expect(
      () => new BrowserWindow({ webPreferences: { contextIsolation: false } }),
    ).toThrow("refused");
    expect(refused).toEqual([
      "this window's sandboxed preload runs in its page's own world, which Domicile's engine doesn't give a preload",
    ]);
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

  it("runs the app's script in its page once loaded, and resolves with what it gave", async () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/");
    sent.length = 0;

    const title = window.webContents.executeJavaScript("document.title", true);
    const thrown = window.webContents.mainFrame.executeJavaScript("throw 1");
    // Electron waits for the page's load under way.
    await Bun.sleep(0);
    expect(sent).toEqual([]);
    say({ type: "window_loaded", window: 1 });
    await Bun.sleep(0);

    expect(sent).toEqual([
      {
        call: 1,
        code: "document.title",
        type: "execute_javascript",
        user_gesture: true,
        window: 1,
      },
      { call: 2, code: "throw 1", type: "execute_javascript", window: 1 },
    ]);
    say({ call: 2, error: "it threw", type: "javascript_result", window: 1 });
    say({ call: 1, result: "A", type: "javascript_result", window: 1 });
    expect(await title).toBe("A");
    await expect(thrown).rejects.toThrow("it threw");
  });

  it("rejects the app's script when its window closes first", async () => {
    const { BrowserWindow, say } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/").catch(() => undefined);

    const waiting = window.webContents.executeJavaScript("1");
    say({ type: "window_closed", window: 1 });

    await expect(waiting).rejects.toThrow("Object has been destroyed");
  });

  it("gives its main frame, the page's one frame, as a WebFrameMain", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/path");
    sent.length = 0;
    const frame = window.webContents.mainFrame;

    expect(window.webContents.mainFrame).toBe(frame);
    expect(frame.url).toBe("https://a.test/path");
    expect(frame.origin).toBe("https://a.test");
    expect(frame.top).toBe(frame);
    expect(frame.parent).toBeNull();
    expect(frame.framesInSubtree).toEqual([frame]);
    frame.send("ping", 1);
    expect(sent).toEqual([
      { args: [1], channel: "ping", type: "ipc_send", window: 1 },
    ]);
  });

  it("drops what it sends before its page opens, as Electron has no page to give it", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow({ show: false });

    window.webContents.send("ready", 1);
    window.webContents.postMessage("port", { a: 1 });

    expect(sent).toEqual([]);
  });

  it("answers its page's sendSync with the returnValue a listener sets", async () => {
    const { BrowserWindow, ipcMain, say, sent } = setUp();
    void new BrowserWindow();
    const answered = new Promise<void>((resolve) => {
      ipcMain.on("triple", (event: { returnValue: unknown }, n: number) => {
        event.returnValue = n * 3;
        queueMicrotask(resolve);
      });
    });

    say({
      args: [3],
      channel: "triple",
      invoke: 4,
      type: "ipc_send_sync",
      window: 1,
    });
    await answered;
    await Promise.resolve();

    expect(sent).toEqual([{ invoke: 4, result: 9, type: "ipc_reply" }]);
  });

  it("posts to its page with ports, and carries what goes over them", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://a.test/");
    sent.length = 0;
    const { port1, port2 } = new MessageChannelMain();

    window.webContents.postMessage("port", { a: 1 }, [port2]);
    port1.postMessage(2);

    expect(sent).toEqual([
      {
        channel: "port",
        message: { a: 1 },
        ports: ["m1"],
        type: "ipc_post",
        window: 1,
      },
      { data: 2, port: "m1", type: "port_post", window: 1 },
    ]);
  });

  it("gives its page's postMessage to ipcMain with ports that end with the page", async () => {
    const { BrowserWindow, ipcMain, say } = setUp();
    void new BrowserWindow();
    const posted = new Promise<[MessagePortMain[], unknown]>((resolve) => {
      ipcMain.on(
        "mine",
        (event: { ports: MessagePortMain[] }, message: unknown) =>
          resolve([event.ports, message]),
      );
    });

    say({
      channel: "mine",
      message: "a port",
      ports: ["r1"],
      type: "ipc_post",
      window: 1,
    });
    const [[port], message] = await posted;
    const heard: unknown[] = [];
    port?.on("message", (event: { data: unknown }) => heard.push(event.data));
    port?.on("close", () => heard.push("closed"));
    port?.start();
    say({ data: 50, port: "r1", type: "port_message", window: 1 });
    say({ type: "page_gone", window: 1 });

    expect(message).toBe("a port");
    expect(heard).toEqual([50, "closed"]);
  });
});

describe("a page's new windows", () => {
  const asked = {
    ask: 3,
    disposition: "foreground-tab",
    features: "width=500,height=600",
    frame_name: "",
    referrer: "https://notes.test/",
    type: "window_open",
    url: "https://sign-in.test/",
    window: 1,
  } as const;

  it("asks the handler, and a denial opens nothing", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    const heard: unknown[] = [];
    window.webContents.setWindowOpenHandler((details) => {
      heard.push(details);
      return { action: "deny" };
    });
    sent.length = 0;

    say(asked);

    expect(heard).toEqual([
      {
        disposition: "foreground-tab",
        features: "width=500,height=600",
        frameName: "",
        postBody: undefined,
        referrer: {
          policy: "strict-origin-when-cross-origin",
          url: "https://notes.test/",
        },
        url: "https://sign-in.test/",
      },
    ]);
    expect(sent).toEqual([
      { action: "deny", ask: 3, type: "window_open_answer" },
    ]);
    expect(BrowserWindow.getAllWindows()).toEqual([window]);
  });

  it("opens an allowed window as a new BrowserWindow, as the opener's", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow({
      webPreferences: { partition: "persist:cowork" },
    });
    void window.loadURL("https://notes.test/");
    const created: unknown[] = [];
    window.webContents.on("did-create-window", (child: unknown) =>
      created.push(child),
    );
    window.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: { title: "Sign in" },
    }));
    sent.length = 0;

    say(asked);

    const child = BrowserWindow.fromId(2);
    expect(created).toEqual([child]);
    expect(sent).toEqual([
      {
        action: "allow",
        ask: 3,
        session: "persist:cowork",
        title: "Sign in",
        type: "window_open_answer",
        window: 2,
      },
    ]);
    expect(child?.getSize()).toEqual([500, 600]);
  });

  it("opens the window with no handler, as Electron does", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    sent.length = 0;

    say(asked);

    expect(sent).toEqual([
      {
        action: "allow",
        ask: 3,
        title: "Notes",
        type: "window_open_answer",
        window: 2,
      },
    ]);
  });

  it("denies the window when the handler throws, and the app hears why", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    window.webContents.setWindowOpenHandler(() => {
      throw new Error("no");
    });
    sent.length = 0;

    expect(() => say(asked)).toThrow("no");
    expect(sent).toEqual([
      { action: "deny", ask: 3, type: "window_open_answer" },
    ]);
  });

  it("opens the window createWindow makes", () => {
    const { BrowserWindow, say, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    window.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      createWindow: (options) =>
        new BrowserWindow({ ...options, show: false }).webContents,
    }));
    sent.length = 0;

    say(asked);

    expect(sent).toEqual([
      {
        action: "allow",
        ask: 3,
        hidden: true,
        title: "Notes",
        type: "window_open_answer",
        window: 2,
      },
    ]);
  });
});

describe("a window's menu bar", () => {
  /** The set_menu_bar requests sent, without the rest. */
  const menuBars = (sent: readonly EngineRequest[]) =>
    sent.filter((request) => request.type === "set_menu_bar");

  const entry = (id: number, label: string): MenuEntry => ({
    checked: false,
    enabled: true,
    id,
    label,
    sublabel: "",
    toolTip: "",
    type: "normal",
    visible: true,
  });

  it("opens with the app's menu, right after the window", () => {
    const { BrowserWindow, menus, sent } = setUp();
    menus.Menu.setApplicationMenu(
      menus.Menu.buildFromTemplate([{ label: "New Note" }]),
    );
    const window = new BrowserWindow();

    void window.loadURL("https://notes.test/");

    expect(sent).toEqual([
      {
        title: "Notes",
        type: "open_window",
        url: "https://notes.test/",
        window: 1,
      },
      {
        auto_hide: false,
        menu: [entry(1, "New Note")],
        type: "set_menu_bar",
        visible: true,
        window: 1,
      },
    ]);
  });

  it("opens with no menu bar when the app has no menu", () => {
    const { BrowserWindow, sent } = setUp();

    void new BrowserWindow().loadURL("https://notes.test/");

    expect(menuBars(sent)).toEqual([]);
  });

  it("follows its menu as it changes, and the menu set in its place", () => {
    const { BrowserWindow, menus, sent } = setUp();
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    const first = menus.Menu.buildFromTemplate([{ label: "New Note" }]);
    const second = menus.Menu.buildFromTemplate([{ label: "Open" }]);
    sent.length = 0;

    window.setMenu(first);
    first.append(new menus.MenuItem({ label: "Close" }));
    window.setMenu(second);
    first.append(new menus.MenuItem({ label: "Unseen" }));
    window.removeMenu();

    expect(menuBars(sent).map(({ menu }) => menu)).toEqual([
      [entry(1, "New Note")],
      [entry(1, "New Note"), entry(3, "Close")],
      [entry(2, "Open")],
      null,
    ]);
  });

  it("gives every window the menu the app sets", () => {
    const { BrowserWindow, menus, sent } = setUp();
    void new BrowserWindow().loadURL("https://notes.test/");
    void new BrowserWindow().loadURL("https://notes.test/");
    sent.length = 0;

    menus.Menu.setApplicationMenu(
      menus.Menu.buildFromTemplate([{ label: "New Note" }]),
    );

    expect(menuBars(sent).map(({ window }) => window)).toEqual([1, 2]);
  });

  it("hides the bar or keeps it until Alt, as the app asks", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow({ autoHideMenuBar: true });
    void window.loadURL("https://notes.test/");

    window.setMenuBarVisibility(false);
    window.setAutoHideMenuBar(false);

    expect(
      menuBars(sent).map(({ auto_hide, visible }) => ({ auto_hide, visible })),
    ).toEqual([
      { auto_hide: true, visible: false },
      { auto_hide: false, visible: false },
    ]);
    expect(window.isMenuBarVisible()).toBe(false);
    expect(window.isMenuBarAutoHide()).toBe(false);
  });

  it("has Electron's properties for it, as Element's settings read them", () => {
    const { BrowserWindow, menus, sent } = setUp();
    menus.Menu.setApplicationMenu(
      menus.Menu.buildFromTemplate([{ label: "New Note" }]),
    );
    const window = new BrowserWindow({ autoHideMenuBar: true });
    void window.loadURL("https://notes.test/");

    const autoHid = window.autoHideMenuBar;
    window.autoHideMenuBar = false;
    window.menuBarVisible = false;

    expect(autoHid).toBe(true);
    expect([window.autoHideMenuBar, window.menuBarVisible]).toEqual([
      false,
      false,
    ]);
    expect(
      menuBars(sent).map(({ auto_hide, visible }) => ({ auto_hide, visible })),
    ).toEqual([
      { auto_hide: true, visible: true },
      { auto_hide: false, visible: true },
      { auto_hide: false, visible: false },
    ]);
  });

  it("tells the engine nothing before the window opens", () => {
    const { BrowserWindow, menus, sent } = setUp();
    const window = new BrowserWindow();

    window.setMenu(menus.Menu.buildFromTemplate([{ label: "New Note" }]));
    window.setMenuBarVisibility(false);

    expect(sent).toEqual([]);
  });

  it("runs a clicked entry for the window whose bar was clicked", () => {
    const { BrowserWindow, menus, say } = setUp();
    const clicks: [string, unknown][] = [];
    const window = new BrowserWindow();
    void window.loadURL("https://notes.test/");
    window.setMenu(
      menus.Menu.buildFromTemplate([
        {
          click: (item, clicked) => clicks.push([item.label, clicked]),
          label: "New Note",
        },
      ]),
    );

    say({ command: 1, type: "menu_clicked", window: 1 });

    expect(clicks).toEqual([["New Note", window]]);
  });
});
