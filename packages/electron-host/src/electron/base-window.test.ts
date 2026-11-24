import { describe, expect, it } from "bun:test";

import type { EngineRequest } from "../engine";
import { setUp } from "./browser-window-fixture";

/** Loads `url` in `page`, whose load a test may cut short by closing it. */
const load = (
  page: { loadURL: (url: string) => Promise<void> },
  url: string,
) => {
  page.loadURL(url).catch(() => undefined);
};

/** The views last placed in `window`, as the engine was told. */
const placed = (sent: readonly EngineRequest[], window: number) =>
  sent.findLast(
    (request) => request.type === "set_views" && request.window === window,
  );

describe("BaseWindow", () => {
  it("opens at once as a window with no page of its own", () => {
    const { app, BaseWindow, sent, webContents } = setUp();
    const created: unknown[] = [];
    app.on("web-contents-created", (_event: unknown, contents: unknown) =>
      created.push(contents),
    );

    const window = new BaseWindow({ show: false, title: "Notes" });

    expect(sent).toEqual([
      {
        hidden: true,
        title: "Notes",
        type: "open_window",
        url: "about:blank",
        window: window.id,
      },
    ]);
    expect(webContents.getAllWebContents()).toEqual([]);
    expect(created).toEqual([]);
  });

  it("holds views in its contentView, a View", () => {
    const { BaseWindow, sent, View, WebContentsView } = setUp();
    const window = new BaseWindow();
    const view = new WebContentsView();
    load(view.webContents, "app://notes/chat");

    window.contentView.addChildView(view);
    view.setBounds({ height: 50, width: 100, x: 10, y: 20 });

    expect(window.contentView).toBeInstanceOf(View);
    expect(window.getContentView()).toBe(window.contentView);
    expect(placed(sent, window.id)).toEqual({
      type: "set_views",
      views: [{ height: 50, width: 100, window: view.id, x: 10, y: 20 }],
      window: window.id,
    });
  });

  it("is one of the app's windows, which BrowserWindow lists only its own of", () => {
    const { BaseWindow, BrowserWindow, say } = setUp();
    const base = new BaseWindow();
    const browser = new BrowserWindow();

    expect(browser).toBeInstanceOf(BaseWindow);
    expect(BaseWindow.getAllWindows()).toEqual([base, browser]);
    expect(BrowserWindow.getAllWindows()).toEqual([browser]);
    expect(BaseWindow.fromId(base.id)).toBe(base);
    expect(BrowserWindow.fromId(base.id)).toBeNull();

    say({
      crashed: false,
      entries: [{ title: "", url: "about:blank" }],
      focused: true,
      frame_token: "T",
      index: 0,
      loading: false,
      pid: 7,
      process_id: 4,
      routing_id: 1,
      type: "page_state",
      waiting: false,
      window: base.id,
    });

    expect(BaseWindow.getFocusedWindow()).toBe(base);
    expect(BrowserWindow.getFocusedWindow()).toBeNull();
  });

  it("fills itself with the view setContentView gives it, at its size", () => {
    const { BaseWindow, say, sent, WebContentsView } = setUp();
    const window = new BaseWindow({ height: 600, width: 800 });
    const view = new WebContentsView();
    load(view.webContents, "app://notes/chat");
    let changes = 0;
    view.on("bounds-changed", () => {
      changes += 1;
    });

    window.setContentView(view);
    say({ height: 700, type: "resized", width: 1000, window: window.id });

    expect(window.contentView).toBe(view);
    expect(view.getBounds()).toEqual({ height: 700, width: 1000, x: 0, y: 0 });
    expect(changes).toBe(2);
    expect(placed(sent, window.id)).toEqual({
      type: "set_views",
      views: [{ height: 700, width: 1000, window: view.id, x: 0, y: 0 }],
      window: window.id,
    });
  });

  it("thinks of no state it would restore", () => {
    const { BaseWindow, sent } = setUp();

    BaseWindow.clearPersistedState("main");

    expect(sent).toEqual([]);
  });
});

describe("BrowserWindow's contentView", () => {
  it("is its own page, whose webContents is the window's", () => {
    const { BrowserWindow, View } = setUp();
    const window = new BrowserWindow();

    expect(window.contentView).toBeInstanceOf(View);
    expect(window.contentView).toHaveProperty(
      "webContents",
      window.webContents,
    );
  });

  it("gives way to the view setContentView gives it, over its page", () => {
    const { BrowserWindow, sent, WebContentsView } = setUp();
    const window = new BrowserWindow({ height: 600, width: 800 });
    load(window, "app://notes/");
    const view = new WebContentsView();
    load(view.webContents, "app://notes/chat");

    window.contentView = view;

    expect(window.getContentView()).toBe(view);
    expect(placed(sent, window.id)).toEqual({
      type: "set_views",
      views: [{ height: 600, width: 800, window: view.id, x: 0, y: 0 }],
      window: window.id,
    });
  });
});

describe("A window's looks and input", () => {
  it("asks the desktop for the user's attention until it has the keyboard", () => {
    const { BaseWindow, say, sent } = setUp();
    const window = new BaseWindow();
    sent.length = 0;

    window.flashFrame(true);
    window.flashFrame(true);
    say({
      crashed: false,
      entries: [{ title: "", url: "about:blank" }],
      focused: true,
      frame_token: "T",
      index: 0,
      loading: false,
      pid: 7,
      process_id: 4,
      routing_id: 1,
      type: "page_state",
      waiting: false,
      window: window.id,
    });
    window.flashFrame(false);

    expect(sent).toEqual([
      { flash: true, type: "flash_frame", window: window.id },
      { flash: false, type: "flash_frame", window: window.id },
    ]);
  });

  it("asks once its page opens what the app asked before", () => {
    const { BrowserWindow, sent } = setUp();
    const window = new BrowserWindow();

    window.flashFrame(true);
    window.setIgnoreMouseEvents(true);
    window.setShape([{ height: 10, width: 20, x: 1, y: 2 }]);
    expect(sent).toEqual([]);
    load(window, "app://notes/");

    expect(sent.slice(1)).toEqual([
      { flash: true, type: "flash_frame", window: window.id },
      { ignore: true, type: "set_ignore_mouse_events", window: window.id },
      {
        rects: [{ height: 10, width: 20, x: 1, y: 2 }],
        type: "set_shape",
        window: window.id,
      },
    ]);
  });

  it("lets the pointer through while it ignores mouse events", () => {
    const { BaseWindow, sent } = setUp();
    const window = new BaseWindow();
    sent.length = 0;

    // `forward` is macOS's and Windows': Electron ignores it on Linux.
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setIgnoreMouseEvents(true);
    window.setIgnoreMouseEvents(false);

    expect(sent).toEqual([
      { ignore: true, type: "set_ignore_mouse_events", window: window.id },
      { ignore: false, type: "set_ignore_mouse_events", window: window.id },
    ]);
  });

  it("draws and takes input only within its shape", () => {
    const { BaseWindow, sent } = setUp();
    const window = new BaseWindow();
    sent.length = 0;

    window.setShape([
      { height: 10, width: 20, x: 1, y: 2 },
      { height: 5, width: 5, x: 30, y: 30 },
    ]);

    expect(sent).toEqual([
      {
        rects: [
          { height: 10, width: 20, x: 1, y: 2 },
          { height: 5, width: 5, x: 30, y: 30 },
        ],
        type: "set_shape",
        window: window.id,
      },
    ]);
  });

  it("shapes itself in whole pixels, and is whole again with no shape", () => {
    const { BaseWindow, sent } = setUp();
    const window = new BaseWindow();
    sent.length = 0;

    window.setShape([{ height: 10.4, width: -1, x: 1.6, y: 2 }]);
    window.setShape([]);

    expect(sent).toEqual([
      {
        rects: [{ height: 10, width: 0, x: 2, y: 2 }],
        type: "set_shape",
        window: window.id,
      },
      { rects: [], type: "set_shape", window: window.id },
    ]);
  });

  it("names itself to desktopCapturer and getUserMedia by its number", () => {
    const { BaseWindow, BrowserWindow } = setUp();

    expect(new BaseWindow().getMediaSourceId()).toBe("window:1:0");
    expect(new BrowserWindow().getMediaSourceId()).toBe("window:2:0");
  });

  it("hears the mouse's back and forward buttons in its page and its views'", () => {
    const { BaseWindow, say, WebContentsView } = setUp();
    const window = new BaseWindow();
    const view = new WebContentsView();
    load(view.webContents, "app://notes/chat");
    window.contentView.addChildView(view);
    const heard: string[] = [];
    window.on("app-command", (_event: unknown, command: string) =>
      heard.push(command),
    );

    say({
      command: "browser-backward",
      type: "app_command",
      window: window.id,
    });
    say({ command: "browser-forward", type: "app_command", window: view.id });

    expect(heard).toEqual(["browser-backward", "browser-forward"]);
  });
});
