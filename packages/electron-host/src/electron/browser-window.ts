// The stand-in for Electron's `BrowserWindow`: each one is an app window on
// the desk, opened over the engine's Electron socket.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Engine, EngineRequest, WindowEvent } from "../engine";
import type { ElectronApp } from "./app";
import type { createIpcMain } from "./ipc-main";
import type { MenuEntry } from "./menu";
import type { MessagePortMain } from "./message-port-main";
import { createPagePorts } from "./message-port-main";
import type { createSessions, Session } from "./session";
import { sessionPartition } from "./session";

export type WebPreferences = {
  readonly preload?: string | undefined;
  /** Electron's partition string; the app's own session when left out. */
  readonly partition?: string | undefined;
  readonly session?: Session | undefined;
  readonly nodeIntegration?: boolean | undefined;
  readonly contextIsolation?: boolean | undefined;
};

export type BrowserWindowOptions = {
  readonly show?: boolean | undefined;
  /** The menu bar hides until the user presses Alt. */
  readonly autoHideMenuBar?: boolean | undefined;
  readonly title?: string | undefined;
  readonly webPreferences?: WebPreferences | undefined;
};

/** Where the windows' pages' IPC goes: the host's side of `ipcMain`. */
export type IpcRoutes = Pick<
  ReturnType<typeof createIpcMain>,
  "invoke" | "post" | "receive" | "sendSync"
>;

/** What a window's menu bar needs of the app's menus. */
export type WindowMenus<Menu> = {
  /** The app's menu, which a new window starts with. */
  readonly applicationMenu: () => Menu | null;
  /** The menu as the menu bar draws it. */
  readonly model: (menu: Menu) => readonly MenuEntry[];
  /** Carries out a click on entry `command` of window `window`'s `menu`. */
  readonly click: (menu: Menu, command: number, window: number) => void;
};

/**
 * Makes the `BrowserWindow` class for an app on `engine`. The engine's window
 * events reach the window they name, and its pages' IPC reaches `ipc`. Its
 * pages load through `sessions`. Its menu bar shows one of `menus`.
 * `readPreload` reads a preload's source.
 */
export const createBrowserWindow = <Menu extends EventEmitter>(
  engine: Engine,
  app: ElectronApp,
  ipc: IpcRoutes,
  sessions: ReturnType<typeof createSessions>,
  menus: WindowMenus<Menu>,
  readPreload: (path: string) => string = (path) => readFileSync(path, "utf8"),
) => {
  const windows = new Map<number, BrowserWindow>();
  const ports = createPagePorts(engine.send);
  let nextId = 1;

  /** The event object Electron passes first to a window listener. */
  const eventObject = () => {
    const event = {
      defaultPrevented: false,
      preventDefault: () => {
        event.defaultPrevented = true;
      },
    };
    return event;
  };

  /** A window's page. Electron's `webContents`, as far as the host has it. */
  class WebContents extends EventEmitter {
    constructor(private readonly owner: BrowserWindow) {
      super();
    }

    get id() {
      return this.owner.id;
    }

    get session() {
      return this.owner.session;
    }

    readonly getTitle = () => this.owner.getTitle();
    readonly getURL = () => this.owner.url;
    readonly isDestroyed = () => this.owner.isDestroyed();
    readonly loadFile = (path: string) => this.owner.loadFile(path);
    readonly loadURL = (url: string) => this.owner.loadURL(url);

    /**
     * Sends `args` on `channel` to the page's `ipcRenderer`. They travel as
     * JSON, so what JSON can't carry doesn't arrive.
     */
    readonly send = (channel: string, ...args: unknown[]) => {
      this.owner.assertAlive();
      engine.send({
        args: JSON.parse(JSON.stringify(args)),
        channel,
        type: "ipc_send",
        window: this.owner.id,
      });
    };

    /**
     * Posts `message` to the page's `ipcRenderer`, with `transfer`, ends of
     * MessageChannelMains, as `event.ports`. The message travels as JSON.
     */
    readonly postMessage = (
      channel: string,
      message: unknown,
      transfer: readonly MessagePortMain[] = [],
    ) => {
      this.owner.assertAlive();
      engine.send({
        channel,
        message: JSON.parse(JSON.stringify([message]))[0],
        ports: ports.give(this.owner.id, transfer),
        type: "ipc_post",
        window: this.owner.id,
      });
    };
  }

  class BrowserWindow extends EventEmitter {
    static readonly fromId = (id: number) => windows.get(id) ?? null;
    static readonly getAllWindows = () => [...windows.values()];
    /** Null: which window has focus is the shell's, and not told yet. */
    static readonly getFocusedWindow = () => null;

    readonly id = nextId++;
    readonly webContents = new WebContents(this);
    url = "";
    #title: string;
    #opened = false;
    #shown = false;
    #destroyed = false;
    #loads: { resolve: () => void; reject: (why: Error) => void }[] = [];
    readonly #preload: string | undefined;
    #menu: Menu | null = menus.applicationMenu();
    #menuBarVisible = true;
    #menuBarAutoHide: boolean;
    /** Its page's session. */
    readonly session: Session;

    constructor(options: BrowserWindowOptions = {}) {
      super();
      const preferences = options.webPreferences ?? {};
      if (
        preferences.nodeIntegration === true ||
        preferences.contextIsolation === false
      ) {
        throw new Error(
          "this window's page needs Node.js or the preload's world, which Domicile's engine doesn't give a page",
        );
      }
      this.#preload =
        preferences.preload === undefined
          ? undefined
          : readPreload(preferences.preload);
      this.session =
        preferences.session ??
        sessions.fromPartition(preferences.partition ?? "");
      this.#title = options.title ?? app.getName();
      this.#menuBarAutoHide = options.autoHideMenuBar ?? false;
      this.#menu?.on("changed", this.#showMenuBar);
      windows.set(this.id, this);
    }

    /**
     * Shows `url`. The first load opens the window, as the engine has no empty
     * windows. Resolves once the page loads, as Electron's does.
     */
    readonly loadURL = (url: string) => {
      this.assertAlive();
      this.url = url;
      const loaded = new Promise<void>((resolve, reject) => {
        this.#loads.push({ reject, resolve });
      });
      if (this.#opened) {
        engine.send({ type: "load_url", url, window: this.id });
      } else {
        this.#opened = true;
        const session = sessionPartition(this.session);
        engine.send({
          type: "open_window",
          url,
          window: this.id,
          ...(this.#preload === undefined ? {} : { preload: this.#preload }),
          ...(session === "" ? {} : { session }),
        });
        // A window opens with no menu bar, so there's only one to tell of.
        if (this.#menu !== null) {
          this.#showMenuBar();
        }
      }
      return loaded;
    };

    /** Shows a file of the app, by its path from the app's root. */
    readonly loadFile = (path: string) =>
      this.loadURL(
        pathToFileURL(isAbsolute(path) ? path : join(app.getAppPath(), path))
          .href,
      );

    readonly show = () => {
      this.focus();
    };

    readonly focus = () => {
      this.assertAlive();
      if (this.#opened) {
        engine.send({ type: "focus_window", window: this.id });
      }
    };

    /** Closes the window once its page agrees, unless a `close` listener prevents it. */
    readonly close = () => {
      if (!this.#destroyed) {
        const event = eventObject();
        this.emit("close", event);
        if (!event.defaultPrevented) {
          this.#end(() => {
            engine.send({ type: "close_window", window: this.id });
          });
        }
      }
    };

    /** Closes the window without asking its page or listeners. */
    readonly destroy = () => {
      if (!this.#destroyed) {
        this.#end(() => {
          engine.send({ type: "destroy_window", window: this.id });
        });
      }
    };

    /** Shows `menu` in the window's menu bar, or no menu bar for null. */
    readonly setMenu = (menu: Menu | null) => {
      this.assertAlive();
      this.#menu?.off("changed", this.#showMenuBar);
      this.#menu = menu;
      this.#menu?.on("changed", this.#showMenuBar);
      this.#showMenuBar();
    };

    readonly removeMenu = () => {
      this.setMenu(null);
    };

    readonly setMenuBarVisibility = (visible: boolean) => {
      this.#menuBarVisible = visible;
      this.#showMenuBar();
    };

    readonly isMenuBarVisible = () => this.#menuBarVisible;

    readonly setAutoHideMenuBar = (autoHide: boolean) => {
      this.#menuBarAutoHide = autoHide;
      this.#showMenuBar();
    };

    readonly isMenuBarAutoHide = () => this.#menuBarAutoHide;

    /** Tells the engine the menu bar as it is now, once the window is open. */
    readonly #showMenuBar = () => {
      if (this.#opened && !this.#destroyed) {
        engine.send({
          auto_hide: this.#menuBarAutoHide,
          menu: this.#menu === null ? null : menus.model(this.#menu),
          type: "set_menu_bar",
          visible: this.#menuBarVisible,
          window: this.id,
        });
      }
    };

    readonly isDestroyed = () => this.#destroyed;
    readonly isVisible = () => this.#shown && !this.#destroyed;
    readonly getTitle = () => this.#title;
    readonly setTitle = (title: string) => {
      this.#title = title;
    };

    /** Takes what the engine said of this window. */
    readonly take = (event: WindowEvent) => {
      switch (event.type) {
        case "window_opened": {
          // Its first page is loading; `window_loaded` says when it's done.
          break;
        }
        case "window_loaded": {
          this.webContents.emit("did-finish-load");
          if (!this.#shown) {
            this.#shown = true;
            this.emit("ready-to-show");
          }
          for (const load of this.#loads.splice(0)) {
            load.resolve();
          }
          break;
        }
        case "title_changed": {
          const titleEvent = eventObject();
          this.emit("page-title-updated", titleEvent, event.title, false);
          if (!titleEvent.defaultPrevented) {
            this.#title = event.title;
          }
          break;
        }
        case "window_refused": {
          this.#refused(event.why);
          break;
        }
        case "window_closed": {
          this.#closed();
          break;
        }
        case "ipc_message": {
          ipc.receive(this.webContents, event.channel, event.args);
          break;
        }
        case "ipc_invoke": {
          this.#answer(
            event.invoke,
            ipc.invoke(this.webContents, event.channel, event.args),
          );
          break;
        }
        case "ipc_send_sync": {
          this.#answer(
            event.invoke,
            ipc.sendSync(this.webContents, event.channel, event.args),
          );
          break;
        }
        case "ipc_post": {
          ipc.post(
            this.webContents,
            event.channel,
            event.message,
            ports.take(this.id, event.ports),
          );
          break;
        }
        case "port_message": {
          ports.message(this.id, event.port, event.data);
          break;
        }
        case "port_closed": {
          ports.closed(this.id, event.port);
          break;
        }
        case "page_gone": {
          ports.gone(this.id);
          break;
        }
        case "menu_clicked": {
          if (this.#menu !== null) {
            menus.click(this.#menu, event.command, this.id);
          }
          break;
        }
      }
    };

    /** Answers invoke or sendSync `invoke` with `answer`, once it settles. */
    readonly #answer = (
      invoke: number,
      answer: ReturnType<IpcRoutes["invoke"]>,
    ) => {
      answer
        .then((settled) => {
          engine.send(
            settled.match<EngineRequest>({
              Err: (error) => ({ error, invoke, type: "ipc_reply" }),
              Ok: ({ result }) => ({ invoke, result, type: "ipc_reply" }),
            }),
          );
        })
        .catch((error: unknown) => {
          // Only the engine's connection failing gets here, and losing it
          // ends the app on its own.
          // biome-ignore lint/suspicious/noConsole: why a page's invoke went unanswered, for the supervisor's log
          console.error("electron-host: couldn't answer an invoke", error);
        });
    };

    /** Ends a window that was never opened at once; asks the engine otherwise. */
    readonly #end = (ask: () => void) => {
      if (this.#opened) {
        ask();
      } else {
        this.#closed();
      }
    };

    readonly #refused = (why: string) => {
      const loads = this.#loads.splice(0);
      if (loads.length > 0) {
        for (const load of loads) {
          load.reject(new Error(why));
        }
      } else if (!this.#destroyed) {
        throw new Error(`the engine refused window ${this.id}: ${why}`);
      }
    };

    readonly #closed = () => {
      if (!this.#destroyed) {
        this.#destroyed = true;
        this.#menu?.off("changed", this.#showMenuBar);
        windows.delete(this.id);
        ports.gone(this.id);
        for (const load of this.#loads.splice(0)) {
          load.reject(new Error("the window closed before its page loaded"));
        }
        this.emit("closed");
        this.webContents.emit("destroyed");
        if (windows.size === 0) {
          allClosed();
        }
      }
    };

    /** Throws as Electron does for a window that's gone. */
    readonly assertAlive = () => {
      if (this.#destroyed) {
        throw new Error("Object has been destroyed");
      }
    };
  }

  /** Electron quits when the last window closes, unless the app listens. */
  const allClosed = () => {
    if (app.listenerCount("window-all-closed") > 0) {
      app.emit("window-all-closed");
    } else {
      app.quit();
    }
  };

  engine.events.on("window", (event) => {
    windows.get(event.window)?.take(event);
  });

  return BrowserWindow;
};

export type BrowserWindow = InstanceType<
  ReturnType<typeof createBrowserWindow>
>;
