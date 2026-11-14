// The stand-in for Electron's `BrowserWindow`: each one is an app window on
// the desk, opened over the engine's Electron socket.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Engine, EngineRequest, WindowEvent } from "../engine";
import type { ElectronApp } from "./app";
import type { createIpcMain } from "./ipc-main";

export type WebPreferences = {
  readonly preload?: string | undefined;
  readonly nodeIntegration?: boolean | undefined;
  readonly contextIsolation?: boolean | undefined;
};

export type BrowserWindowOptions = {
  readonly show?: boolean | undefined;
  readonly title?: string | undefined;
  readonly webPreferences?: WebPreferences | undefined;
};

/** Where the windows' pages' IPC goes: the host's side of `ipcMain`. */
export type IpcRoutes = Pick<
  ReturnType<typeof createIpcMain>,
  "invoke" | "receive"
>;

/**
 * Makes the `BrowserWindow` class for an app on `engine`. The engine's window
 * events reach the window they name, and its pages' IPC reaches `ipc`.
 * `readPreload` reads a preload's source.
 */
export const createBrowserWindow = (
  engine: Engine,
  app: ElectronApp,
  ipc: IpcRoutes,
  readPreload: (path: string) => string = (path) => readFileSync(path, "utf8"),
) => {
  const windows = new Map<number, BrowserWindow>();
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
      this.#title = options.title ?? app.getName();
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
        engine.send({
          type: "open_window",
          url,
          window: this.id,
          ...(this.#preload === undefined ? {} : { preload: this.#preload }),
        });
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

    readonly isDestroyed = () => this.#destroyed;
    readonly isVisible = () => this.#shown && !this.#destroyed;
    readonly getTitle = () => this.#title;
    readonly setTitle = (title: string) => {
      this.#title = title;
    };

    /** Takes what the engine said of this window. */
    readonly take = (event: WindowEvent) => {
      if (event.type === "window_opened") {
        // Its first page is loading; `window_loaded` says when it's done.
      } else if (event.type === "window_loaded") {
        this.webContents.emit("did-finish-load");
        if (!this.#shown) {
          this.#shown = true;
          this.emit("ready-to-show");
        }
        for (const load of this.#loads.splice(0)) {
          load.resolve();
        }
      } else if (event.type === "title_changed") {
        const titleEvent = eventObject();
        this.emit("page-title-updated", titleEvent, event.title, false);
        if (!titleEvent.defaultPrevented) {
          this.#title = event.title;
        }
      } else if (event.type === "window_refused") {
        this.#refused(event.why);
      } else if (event.type === "ipc_message") {
        ipc.receive(this.webContents, event.channel, event.args);
      } else if (event.type === "ipc_invoke") {
        ipc
          .invoke(this.webContents, event.channel, event.args)
          .then((answer) => {
            engine.send(
              answer.match<EngineRequest>({
                Err: (error) => ({
                  error,
                  invoke: event.invoke,
                  type: "ipc_reply",
                }),
                Ok: ({ result }) => ({
                  invoke: event.invoke,
                  result,
                  type: "ipc_reply",
                }),
              }),
            );
          })
          .catch((error: unknown) => {
            // Only the engine's connection failing gets here, and losing it
            // ends the app on its own.
            // biome-ignore lint/suspicious/noConsole: why a page's invoke went unanswered, for the supervisor's log
            console.error("electron-host: couldn't answer an invoke", error);
          });
      } else {
        this.#closed();
      }
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
        windows.delete(this.id);
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
