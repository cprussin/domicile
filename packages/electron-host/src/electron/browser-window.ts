// The stand-ins for Electron's `BrowserWindow`, `WebContentsView` and
// `BrowserView`. Each window is an app window on the desk, opened over the
// engine's Electron socket. Each view is a page the shell draws as part of the
// window that holds it. See "Windows" in docs/architecture/ELECTRON-APPS.md.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  Engine,
  EngineRequest,
  ViewPlacement,
  WindowEvent,
} from "../engine";
import type { ElectronApp } from "./app";
import type { createIpcMain } from "./ipc-main";
import { IpcMain } from "./ipc-main";
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
  /** The size it starts at, until the shell gives it one. */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly webPreferences?: WebPreferences | undefined;
};

export type ViewOptions = {
  readonly webPreferences?: WebPreferences | undefined;
};

/** Electron's `Rectangle`. */
export type Rectangle = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A `BrowserView`'s `setAutoResize`: what follows its window's size. */
export type AutoResize = {
  readonly width?: boolean | undefined;
  readonly height?: boolean | undefined;
  readonly horizontal?: boolean | undefined;
  readonly vertical?: boolean | undefined;
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

/** Electron's size for a window that asks for none. */
const DEFAULT_SIZE = { height: 600, width: 800 };

/** What this host has warned of, so each warning shows once. */
const warned = new Set<string>();
const warnOnce = (key: string, why: string) => {
  if (!warned.has(key)) {
    warned.add(key);
    // biome-ignore lint/suspicious/noConsole: the app's log is where a stated answer is told
    console.warn(`electron-host: ${why}`);
  }
};

const NO_BOUNDS: Rectangle = { height: 0, width: 0, x: 0, y: 0 };

/**
 * One side of a BrowserView that follows its window: scaled with it, grown by
 * as much as it grew, or left.
 */
const followed = (
  size: number,
  scales: boolean | undefined,
  grows: boolean | undefined,
  growth: number,
  scale: number,
) => {
  if (scales) {
    return Math.round(size * scale);
  } else if (grows) {
    return size + growth;
  } else {
    return size;
  }
};

/**
 * Makes the `BrowserWindow`, `WebContentsView` and `BrowserView` classes for
 * an app on `engine`. The engine's window events reach the page they name, and
 * its pages' IPC reaches `ipc`. Its pages load through `sessions`. A window's
 * menu bar shows one of `menus`. `readPreload` reads a preload's source. `webContentsOf` finds a page by the
 * engine's number, a window's or a view's.
 */
export const createBrowserWindow = <Menu extends EventEmitter>(
  engine: Engine,
  app: ElectronApp,
  ipc: IpcRoutes,
  sessions: ReturnType<typeof createSessions>,
  menus: WindowMenus<Menu>,
  readPreload: (path: string) => string = (path) => readFileSync(path, "utf8"),
  /**
   * Gives up on an app whose page needs what the engine doesn't do yet. The
   * host exits with `UNSUPPORTED_EXIT`, so the app runs on its own Electron.
   */
  refuse: (why: string) => never = (why) => {
    throw new Error(why);
  },
) => {
  /** Every page by the engine's number: windows' and views'. */
  const pages = new Map<number, Page>();
  const windows = new Map<number, BrowserWindow>();
  /**
   * Sends `request` to the engine, unless it's for a page the engine hasn't
   * opened yet, which the engine would refuse: that is said and dropped.
   */
  /** The last few kinds of request each window was sent, for a refusal. */
  const sentTo = new Map<number, string[]>();
  const toEngine: Engine["send"] = (request) => {
    const page =
      "window" in request && request.type !== "open_window"
        ? pages.get(request.window as number)
        : undefined;
    if ("window" in request) {
      const kinds = sentTo.get(request.window as number) ?? [];
      sentTo.set(request.window as number, [...kinds.slice(-3), request.type]);
    }
    if (page !== undefined && !page.isOpen()) {
      warnOnce(
        `unopened ${request.type}`,
        `${app.getName()} sent ${request.type} to a window before loading it, which goes nowhere`,
      );
      return;
    }
    engine.send(request);
  };
  const ports = createPagePorts(toEngine);
  let nextId = 1;
  /** Numbers the app's executeJavaScript calls, across its pages. */
  let nextCall = 1;

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

  /**
   * Electron's `WebFrameMain` for a page's main frame. The engine runs the
   * app's scripts and IPC only in the main frame, so it has no others.
   */
  class WebFrameMain extends EventEmitter {
    constructor(readonly page: Page) {
      super();
    }

    get ipc() {
      return this.page.webContents.ipc;
    }
    get url() {
      return this.page.url;
    }
    get origin() {
      return URL.canParse(this.page.url) ? new URL(this.page.url).origin : "";
    }
    get top() {
      return this;
    }
    get parent() {
      return null;
    }
    get frames() {
      return [];
    }
    get framesInSubtree() {
      return [this];
    }
    get detached() {
      return false;
    }
    get name() {
      return "";
    }
    get visibilityState() {
      return "visible";
    }
    get routingId() {
      return this.page.id;
    }
    get frameTreeNodeId() {
      return this.page.id;
    }
    get processId() {
      return 0;
    }
    get osProcessId() {
      return 0;
    }
    readonly isDestroyed = () => this.page.isDestroyed();
    readonly executeJavaScript = (code: string, userGesture = false) =>
      this.page.runJavaScript(code, userGesture);
    readonly send = (channel: string, ...args: unknown[]) => {
      this.page.webContents.send(channel, ...args);
    };
    readonly postMessage = (
      channel: string,
      message: unknown,
      transfer: readonly MessagePortMain[] = [],
    ) => {
      this.page.webContents.postMessage(channel, message, transfer);
    };
    readonly reload = () => {
      // Electron's answers only whether the reload started.
      void this.page.webContents.reload().catch(() => undefined);
      return true;
    };
  }

  /** A page's `webContents`, as far as the host has it. */
  class WebContents extends EventEmitter {
    /** What this page alone sends, heard before `ipcMain`. */
    readonly ipc = new IpcMain();
    #mainFrame: WebFrameMain | undefined;

    constructor(readonly owner: Page) {
      super();
    }

    /** Its page's main frame, the one frame the app reaches. */
    get mainFrame() {
      this.#mainFrame ??= new WebFrameMain(this.owner);
      return this.#mainFrame;
    }

    /**
     * Runs `code` in the page's own world once its page has loaded, and
     * resolves with what it gives, a promise settled, as JSON carries it.
     */
    readonly executeJavaScript = (code: string, userGesture = false) =>
      this.owner.runJavaScript(code, userGesture);

    get id() {
      return this.owner.id;
    }

    get session() {
      return this.owner.session;
    }

    /**
     * Not asked yet: the engine opens a page's new windows and
     * `target=_blank` links as the desktop's browser does.
     */
    readonly setWindowOpenHandler = (_handler: unknown) => undefined;

    readonly getTitle = () => this.owner.getTitle();
    readonly focus = () => {
      if (this.owner instanceof BrowserWindow) {
        this.owner.focus();
      }
    };
    /** The engine keeps each page's history, which the app can't walk yet. */
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      canGoToOffset: (_offset: number) => false,
      clear: () => undefined,
      getActiveIndex: () => 0,
      getAllEntries: () => [{ title: this.getTitle(), url: this.owner.url }],
      getEntryAtIndex: (index: number) =>
        index === 0 ? { title: this.getTitle(), url: this.owner.url } : null,
      goBack: () => undefined,
      goForward: () => undefined,
      goToIndex: (_index: number) => undefined,
      goToOffset: (_offset: number) => undefined,
      length: () => 1,
    };
    zoomFactor = 1;
    zoomLevel = 0;
    readonly isFocused = () => false;
    readonly isLoading = () => false;
    readonly isLoadingMainFrame = () => false;
    readonly isWaitingForResponse = () => false;
    readonly isCrashed = () => false;
    readonly reload = () => this.owner.loadURL(this.owner.url);
    readonly getOSProcessId = () => 0;
    readonly getProcessId = () => 0;
    // The engine's DevTools aren't the app's to open yet.
    readonly openDevTools = (_options?: unknown) => undefined;
    readonly closeDevTools = () => undefined;
    readonly isDevToolsOpened = () => false;
    readonly isDevToolsFocused = () => false;
    readonly toggleDevTools = () => undefined;
    // The engine's settings for every page, not each app's.
    readonly setBackgroundThrottling = (_allowed: boolean) => undefined;
    readonly getBackgroundThrottling = () => true;
    readonly setWebRTCIPHandlingPolicy = (_policy: string) => undefined;
    readonly getWebRTCIPHandlingPolicy = () => "default";
    readonly setUserAgent = (_userAgent: string) => undefined;
    readonly getUserAgent = () => "";
    readonly setAudioMuted = (_muted: boolean) => undefined;
    readonly isAudioMuted = () => false;
    get audioMuted() {
      return this.isAudioMuted();
    }
    set audioMuted(muted: boolean) {
      this.setAudioMuted(muted);
    }
    get backgroundThrottling() {
      return this.getBackgroundThrottling();
    }
    set backgroundThrottling(allowed: boolean) {
      this.setBackgroundThrottling(allowed);
    }
    get userAgent() {
      return this.getUserAgent();
    }
    set userAgent(userAgent: string) {
      this.setUserAgent(userAgent);
    }
    readonly isCurrentlyAudible = () => false;
    // The shell zooms pages: the app's zoom is kept, not applied.
    readonly getZoomFactor = () => this.zoomFactor;
    readonly getZoomLevel = () => this.zoomLevel;
    readonly setZoomFactor = (factor: number) => {
      this.zoomFactor = factor;
    };
    readonly setZoomLevel = (level: number) => {
      this.zoomLevel = level;
    };
    readonly setVisualZoomLevelLimits = async (_min: number, _max: number) =>
      undefined;
    readonly setIgnoreMenuShortcuts = (_ignore: boolean) => undefined;
    readonly getURL = () => this.owner.url;
    readonly isDestroyed = () => this.owner.isDestroyed();
    readonly loadFile = (path: string) => this.owner.loadFile(path);
    readonly loadURL = (url: string) => this.owner.loadURL(url);
    /** Closes the page at once: a window's ends the window. */
    readonly close = () => {
      this.owner.destroy();
    };

    /**
     * Sends `args` on `channel` to the page's `ipcRenderer`. They travel as
     * JSON, so what JSON can't carry doesn't arrive.
     */
    readonly send = (channel: string, ...args: unknown[]) => {
      this.owner.assertAlive();
      // Before its page opens there's no page to hear it, as in Electron.
      if (!this.owner.isOpen()) {
        return;
      }
      toEngine({
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
      if (!this.owner.isOpen()) {
        return;
      }
      toEngine({
        channel,
        message: JSON.parse(JSON.stringify([message]))[0],
        ports: ports.give(this.owner.id, transfer),
        type: "ipc_post",
        window: this.owner.id,
      });
    };
  }

  /**
   * One page on the engine, a window's or a view's: what both kinds share.
   * The engine has no empty pages, so it opens with the first load.
   */
  abstract class Page extends EventEmitter {
    readonly id = nextId++;
    readonly webContents = new WebContents(this);
    url = "";
    /** Its page's session. */
    readonly session: Session;
    protected title: string;
    protected opened = false;
    /** Whether the engine has its page: whether a load has started. */
    readonly isOpen = () => this.opened;
    protected destroyed = false;
    #loads: { resolve: () => void; reject: (why: Error) => void }[] = [];
    /** Whether a load has started that hasn't finished. */
    #loading = false;
    /** The app's scripts that wait for the page to load. */
    #toRun: (() => void)[] = [];
    /** The app's scripts the engine runs, by call. */
    #running = new Map<
      number,
      { resolve: (result: unknown) => void; reject: (why: Error) => void }
    >();
    readonly #preload: string | undefined;
    readonly #view: boolean;

    constructor(preferences: WebPreferences, title: string, view: boolean) {
      super();
      if (
        preferences.nodeIntegration === true ||
        preferences.contextIsolation === false
      ) {
        refuse(
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
      this.title = title;
      this.#view = view;
      pages.set(this.id, this);
    }

    /**
     * Runs `code` in the page's main world, after any load under way, as
     * Electron's executeJavaScript waits for one.
     */
    readonly runJavaScript = async (code: string, userGesture: boolean) => {
      this.assertAlive();
      if (!this.opened || this.#loading) {
        await new Promise<void>((resolve) => this.#toRun.push(resolve));
      }
      this.assertAlive();
      const call = nextCall++;
      return new Promise<unknown>((resolve, reject) => {
        this.#running.set(call, { reject, resolve });
        toEngine({
          call,
          code,
          type: "execute_javascript",
          window: this.id,
          ...(userGesture ? { user_gesture: true } : {}),
        });
      });
    };

    /** Shows `url`. Resolves once the page loads, as Electron's does. */
    readonly loadURL = (url: string) => {
      this.assertAlive();
      this.url = url;
      this.#loading = true;
      const loaded = new Promise<void>((resolve, reject) => {
        this.#loads.push({ reject, resolve });
      });
      if (this.opened) {
        toEngine({ type: "load_url", url, window: this.id });
      } else {
        this.opened = true;
        const session = sessionPartition(this.session);
        toEngine({
          type: "open_window",
          url,
          window: this.id,
          ...(this.#preload === undefined ? {} : { preload: this.#preload }),
          ...(session === "" ? {} : { session }),
          ...(this.#view ? { view: true } : {}),
          ...this.opening(),
        });
        this.wasOpened();
      }
      return loaded;
    };

    /** Shows a file of the app, by its path from the app's root. */
    readonly loadFile = (path: string) =>
      this.loadURL(
        pathToFileURL(isAbsolute(path) ? path : join(app.getAppPath(), path))
          .href,
      );

    /** Closes the page without asking it or any listener. */
    readonly destroy = () => {
      if (!this.destroyed) {
        this.end(() => {
          toEngine({ type: "destroy_window", window: this.id });
        });
      }
    };

    readonly isDestroyed = () => this.destroyed;
    readonly getTitle = () => this.title;

    /** Takes what the engine said of this page. */
    readonly take = (event: WindowEvent) => {
      switch (event.type) {
        case "window_opened": {
          // Its first page is loading; `window_loaded` says when it's done.
          break;
        }
        case "window_loaded": {
          this.#loading = false;
          for (const run of this.#toRun.splice(0)) {
            run();
          }
          this.webContents.emit("did-finish-load");
          this.wasLoaded();
          for (const load of this.#loads.splice(0)) {
            load.resolve();
          }
          break;
        }
        case "title_changed": {
          this.titled(event.title);
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
        case "resized": {
          this.resized(event.width, event.height);
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
          this.menuClicked(event.command);
          break;
        }
        case "close_asked": {
          this.closeAsked();
          break;
        }
        case "javascript_result": {
          const running = this.#running.get(event.call);
          this.#running.delete(event.call);
          if (running === undefined) {
            throw new Error(
              `the engine answered script ${event.call} of window ${this.id}, which nothing waits on`,
            );
          } else if (event.error === undefined) {
            running.resolve(event.result);
          } else {
            running.reject(new Error(event.error));
          }
          break;
        }
      }
    };

    /** Throws as Electron does for a page that's gone. */
    readonly assertAlive = () => {
      if (this.destroyed) {
        throw new Error("Object has been destroyed");
      }
    };

    /** What only a window says of itself as it opens. */
    protected opening(): { title?: string; hidden?: true } {
      return {};
    }

    /** The user asked to close the page's window. */
    protected closeAsked() {
      // Only a window can be closed by the user.
    }

    /** The engine opened the page. */
    protected wasOpened() {
      // Only a window or a view has more to do.
    }

    /** The page loaded. */
    protected wasLoaded() {
      // Only a window has more to do.
    }

    /** The page's title changed to `title`. */
    protected titled(title: string) {
      this.title = title;
      this.webContents.emit("page-title-updated", eventObject(), title, false);
    }

    /** The shell gave the page a size. */
    protected resized(_width: number, _height: number) {
      // Only a window has more to do.
    }

    /** The user chose entry `command` of the page's menu bar. */
    protected menuClicked(_command: number) {
      // Only a window has a menu bar.
    }

    /** The page is gone. */
    protected wasClosed() {
      // Only a window or a view has more to do.
    }

    /** Ends a page that was never opened at once; asks the engine otherwise. */
    protected readonly end = (ask: () => void) => {
      if (this.opened) {
        ask();
      } else {
        this.#closed();
      }
    };

    /** Answers invoke or sendSync `invoke` with `answer`, once it settles. */
    readonly #answer = (
      invoke: number,
      answer: ReturnType<IpcRoutes["invoke"]>,
    ) => {
      answer
        .then((settled) => {
          toEngine(
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

    readonly #refused = (why: string) => {
      const loads = this.#loads.splice(0);
      const sent = (sentTo.get(this.id) ?? []).join(", ");
      // An app may swallow its load's rejection; the log keeps why.
      // biome-ignore lint/suspicious/noConsole: a refused window is the engine's word on the app, for the supervisor's log
      console.error(
        `electron-host: the engine refused window ${this.id} (last sent: ${sent}): ${why}`,
      );
      if (loads.length > 0) {
        for (const load of loads) {
          load.reject(new Error(why));
        }
      } else if (!this.destroyed) {
        throw new Error(`the engine refused window ${this.id}: ${why}`);
      }
    };

    readonly #closed = () => {
      if (!this.destroyed) {
        this.destroyed = true;
        pages.delete(this.id);
        ports.gone(this.id);
        for (const load of this.#loads.splice(0)) {
          load.reject(new Error("the window closed before its page loaded"));
        }
        // A script waiting to run hears the page is gone, as one running does.
        for (const run of this.#toRun.splice(0)) {
          run();
        }
        for (const running of this.#running.values()) {
          running.reject(new Error("the window closed before its script ran"));
        }
        this.#running.clear();
        this.wasClosed();
        this.webContents.emit("destroyed");
      }
    };
  }

  /**
   * Electron's `WebContentsView`: a page the shell draws as part of the window
   * whose `contentView` holds it, where the app puts it. It outlives that
   * window until the app closes its page.
   */
  class WebContentsView extends Page {
    #bounds: Rectangle = NO_BOUNDS;
    #visible = true;
    /** The window whose contentView holds it. */
    holder: BrowserWindow | undefined;

    constructor(options: ViewOptions = {}) {
      super(options.webPreferences ?? {}, "", true);
    }

    /** Where the app asks for it in its window, in CSS pixels. */
    readonly setBounds = (bounds: Rectangle) => {
      this.#bounds = {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      };
      this.holder?.placeViews();
    };

    readonly getBounds = (): Rectangle => this.#bounds;

    /** Hides or shows it. A hidden view keeps its page and its place. */
    readonly setVisible = (visible: boolean) => {
      this.#visible = visible;
      this.holder?.placeViews();
    };

    readonly getVisible = () => this.#visible;

    /** The shell draws views; the app's color and corners are its own look. */
    readonly setBackgroundColor = (_color: string) => undefined;
    readonly setBorderRadius = (_radius: number) => undefined;

    readonly children: readonly WebContentsView[] = [];

    /** Electron nests views; Domicile's engine has only a window hold them. */
    readonly addChildView = (_view: WebContentsView, _index?: number) => {
      throw new Error(
        "only a window's contentView holds views on Domicile: this app nests a view in a view",
      );
    };

    readonly removeChildView = (_view: WebContentsView) => undefined;

    /** Where the engine is told to put it, or nothing before it opens. */
    readonly placement = (): ViewPlacement | undefined =>
      this.opened && !this.destroyed
        ? {
            ...this.#bounds,
            ...(this.#visible ? {} : { hidden: true }),
            window: this.id,
          }
        : undefined;

    protected override wasOpened() {
      this.holder?.placeViews();
    }

    protected override wasClosed() {
      this.holder?.contentView.removeChildView(this);
    }
  }

  /**
   * Electron's `BrowserView`, the older view: a `WebContentsView` placed with
   * the window's `setBrowserView` and kin, which can follow its window's size.
   */
  class BrowserView extends WebContentsView {
    #autoResize: AutoResize = {};

    readonly setAutoResize = (options: AutoResize) => {
      this.#autoResize = options;
    };

    /** Follows its window from `from` to `to`, as its autoResize asks. */
    readonly follow = (
      from: { width: number; height: number },
      to: { width: number; height: number },
    ) => {
      const { height, horizontal, vertical, width } = this.#autoResize;
      const bounds = this.getBounds();
      const scaleX = from.width === 0 ? 1 : to.width / from.width;
      const scaleY = from.height === 0 ? 1 : to.height / from.height;
      const next = {
        height: followed(
          bounds.height,
          vertical,
          height,
          to.height - from.height,
          scaleY,
        ),
        width: followed(
          bounds.width,
          horizontal,
          width,
          to.width - from.width,
          scaleX,
        ),
        x: horizontal ? Math.round(bounds.x * scaleX) : bounds.x,
        y: vertical ? Math.round(bounds.y * scaleY) : bounds.y,
      };
      if (
        next.x !== bounds.x ||
        next.y !== bounds.y ||
        next.width !== bounds.width ||
        next.height !== bounds.height
      ) {
        this.setBounds(next);
      }
    };
  }

  /** A window's `contentView`: its page, and the views over it, bottom first. */
  class ContentView {
    #children: WebContentsView[] = [];

    constructor(private readonly window: BrowserWindow) {}

    get children(): readonly WebContentsView[] {
      return [...this.#children];
    }

    /**
     * Puts `view` at `index`, or on top, taking it from any window that held
     * it. A view it already holds moves.
     */
    readonly addChildView = (view: WebContentsView, index?: number) => {
      const from = view.holder;
      if (from !== undefined && from !== this.window) {
        from.contentView.removeChildView(view);
      }
      this.#children = this.#children.filter((child) => child !== view);
      this.#children.splice(index ?? this.#children.length, 0, view);
      view.holder = this.window;
      this.window.placeViews();
    };

    readonly removeChildView = (view: WebContentsView) => {
      if (this.#children.includes(view)) {
        this.#children = this.#children.filter((child) => child !== view);
        view.holder = undefined;
        this.window.placeViews();
      }
    };

    /** The window's page fills it, at the size the shell gave it. */
    readonly getBounds = () => this.window.getContentBounds();

    /** The shell lays out windows: a window's size is not the app's to set. */
    readonly setBounds = (_bounds: Rectangle) => undefined;
    readonly setBackgroundColor = (_color: string) => undefined;
  }

  class BrowserWindow extends Page {
    static readonly fromId = (id: number) => windows.get(id) ?? null;
    static readonly getAllWindows = () => [...windows.values()];
    /** Null: which window has focus is the shell's, and not told yet. */
    static readonly getFocusedWindow = () => null;
    /** The window of `webContents`' page, or of the view it is. */
    static readonly fromWebContents = (webContents: WebContents) => {
      const { owner } = webContents;
      if (owner instanceof BrowserWindow) {
        return owner;
      } else if (owner instanceof WebContentsView) {
        return owner.holder ?? null;
      } else {
        return null;
      }
    };
    static readonly fromBrowserView = (view: BrowserView) =>
      view.holder ?? null;

    readonly contentView = new ContentView(this);
    #shown = false;
    /** Hidden by the app: open, its page running, out of the desk's sight. */
    #hidden: boolean;
    #size: { width: number; height: number };
    /** The views the engine last placed, as it was told them. */
    #placed = "[]";
    #menu: Menu | null = menus.applicationMenu();
    #menuBarVisible = true;
    #menuBarAutoHide: boolean;

    constructor(options: BrowserWindowOptions = {}) {
      super(
        options.webPreferences ?? {},
        options.title ?? app.getName(),
        false,
      );
      this.#hidden = options.show === false;
      this.#size = {
        height: options.height ?? DEFAULT_SIZE.height,
        width: options.width ?? DEFAULT_SIZE.width,
      };
      this.#menuBarAutoHide = options.autoHideMenuBar ?? false;
      this.#menu?.on("changed", this.#showMenuBar);
      windows.set(this.id, this);
    }

    /** Shows the window if the app hid it, and focuses it. */
    readonly show = () => {
      this.assertAlive();
      this.#setHidden(false);
      this.focus();
    };

    /** Shows the window if the app hid it, leaving focus where it is. */
    readonly showInactive = () => {
      this.assertAlive();
      this.#setHidden(false);
    };

    /**
     * Takes the window out of the desk's sight, its page still running, as
     * an app that closes to its tray does.
     */
    readonly hide = () => {
      this.assertAlive();
      this.#setHidden(true);
    };

    readonly #setHidden = (hidden: boolean) => {
      if (this.#hidden !== hidden) {
        this.#hidden = hidden;
        if (this.opened) {
          toEngine({ hidden, type: "set_hidden", window: this.id });
        }
        this.emit(hidden ? "hide" : "show");
      }
    };

    readonly focus = () => {
      this.assertAlive();
      if (this.opened) {
        toEngine({ type: "focus_window", window: this.id });
      }
    };

    /** Closes the window once its page agrees, unless a `close` listener prevents it. */
    readonly close = () => {
      if (!this.destroyed) {
        const event = eventObject();
        this.emit("close", event);
        if (!event.defaultPrevented) {
          this.end(() => {
            toEngine({ type: "close_window", window: this.id });
          });
        }
      }
    };

    readonly isVisible = () => this.#shown && !this.#hidden && !this.destroyed;
    /** The title the desktop shows for the window, over its page's. */
    readonly setTitle = (title: string) => {
      this.title = title;
      if (this.opened && !this.destroyed) {
        toEngine({ title, type: "set_title", window: this.id });
      }
    };

    /** Its page's box, at the size the shell gave it. */
    readonly getContentBounds = (): Rectangle => ({
      ...this.#size,
      x: 0,
      y: 0,
    });
    /** The shell draws the frame, so the window is its page. */
    readonly getBounds = () => this.getContentBounds();
    readonly getSize = () => [this.#size.width, this.#size.height];
    readonly getContentSize = () => this.getSize();

    // The shell lays windows out and decides their state: a window asks
    // nothing of it, and reads as the shell keeps every window, shown and
    // normal, where the shell put it.
    readonly isMinimized = () => false;
    readonly isMaximized = () => false;
    readonly isFullScreen = () => false;
    readonly isSimpleFullScreen = () => false;
    readonly isNormal = () => true;
    readonly isKiosk = () => false;
    readonly isModal = () => false;
    readonly isAlwaysOnTop = () => false;
    readonly isEnabled = () => true;
    readonly isFocusable = () => true;
    readonly isResizable = () => true;
    readonly isMovable = () => true;
    readonly isMinimizable = () => true;
    readonly isMaximizable = () => true;
    readonly isFullScreenable = () => true;
    readonly isClosable = () => true;
    readonly isVisibleOnAllWorkspaces = () => false;
    readonly minimize = () => undefined;
    readonly maximize = () => undefined;
    readonly unmaximize = () => undefined;
    readonly restore = () => undefined;
    readonly blur = () => undefined;
    readonly center = () => undefined;
    readonly setFullScreen = (_flag: boolean) => undefined;
    readonly setSimpleFullScreen = (_flag: boolean) => undefined;
    readonly setKiosk = (_flag: boolean) => undefined;
    readonly setAlwaysOnTop = (_flag: boolean, _level?: string) => undefined;
    readonly setEnabled = (_enabled: boolean) => undefined;
    readonly setFocusable = (_focusable: boolean) => undefined;
    readonly setResizable = (_resizable: boolean) => undefined;
    readonly setMovable = (_movable: boolean) => undefined;
    readonly setMinimizable = (_minimizable: boolean) => undefined;
    readonly setMaximizable = (_maximizable: boolean) => undefined;
    readonly setFullScreenable = (_fullscreenable: boolean) => undefined;
    readonly setClosable = (_closable: boolean) => undefined;
    readonly setSkipTaskbar = (_skip: boolean) => undefined;
    readonly setVisibleOnAllWorkspaces = (_visible: boolean) => undefined;
    readonly setMinimumSize = (_width: number, _height: number) => undefined;
    readonly setMaximumSize = (_width: number, _height: number) => undefined;
    readonly getMinimumSize = () => [0, 0];
    readonly getMaximumSize = () => [0, 0];
    readonly setAspectRatio = (_ratio: number) => undefined;
    readonly setBounds = (_bounds: Partial<Rectangle>) => undefined;
    readonly setSize = (_width: number, _height: number) => undefined;
    readonly setContentSize = (_width: number, _height: number) => undefined;
    readonly setContentBounds = (_bounds: Partial<Rectangle>) => undefined;
    readonly setPosition = (_x: number, _y: number) => undefined;
    readonly getPosition = () => [0, 0];
    readonly getNormalBounds = () => this.getBounds();
    // The desktop file names the app's icon, and the shell draws windows.
    readonly setIcon = (_icon: unknown) => undefined;
    readonly setBackgroundColor = (_color: string) => undefined;
    readonly getBackgroundColor = () => "#FFFFFF";
    readonly setHasShadow = (_shadow: boolean) => undefined;
    readonly hasShadow = () => false;
    readonly setOpacity = (_opacity: number) => undefined;
    readonly getOpacity = () => 1;
    readonly setIgnoreMouseEvents = (_ignore: boolean) => undefined;
    readonly setProgressBar = (_progress: number) => undefined;
    // The shell draws every window's frame, so there is no title bar to
    // overlay.
    readonly setTitleBarOverlay = (_options: unknown) => undefined;
    readonly setContentProtection = (_enable: boolean) => undefined;
    readonly isContentProtected = () => false;
    /** No shell shows an attention request yet. */
    readonly flashFrame = (_flag: boolean) => undefined;
    readonly getParentWindow = () => null;
    readonly getChildWindows = () => [];
    readonly setParentWindow = (_parent: unknown) => undefined;
    readonly getNativeWindowHandle = () => Buffer.alloc(8);
    readonly getMediaSourceId = () => "";
    readonly isFocused = () => this.isVisible();
    readonly reload = () => this.webContents.reload();

    readonly setBrowserView = (view: BrowserView | null) => {
      for (const held of this.getBrowserViews()) {
        if (held !== view) {
          this.contentView.removeChildView(held);
        }
      }
      if (view !== null) {
        this.contentView.addChildView(view);
      }
    };

    readonly addBrowserView = (view: BrowserView) => {
      this.contentView.addChildView(view);
    };

    readonly removeBrowserView = (view: BrowserView) => {
      this.contentView.removeChildView(view);
    };

    readonly setTopBrowserView = (view: BrowserView) => {
      this.contentView.addChildView(view);
    };

    readonly getBrowserViews = () =>
      this.contentView.children.filter(
        (child): child is BrowserView => child instanceof BrowserView,
      );

    /** Its one BrowserView, as Electron throws for a window with more. */
    readonly getBrowserView = () => {
      const views = this.getBrowserViews();
      if (views.length > 1) {
        throw new Error(
          "BrowserWindow have multiple BrowserViews, use getBrowserViews() instead: this window holds more than one BrowserView",
        );
      }
      return views[0] ?? null;
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

    // Electron's properties for what the methods above set and read.
    get autoHideMenuBar() {
      return this.isMenuBarAutoHide();
    }
    set autoHideMenuBar(autoHide: boolean) {
      this.setAutoHideMenuBar(autoHide);
    }
    get menuBarVisible() {
      return this.isMenuBarVisible();
    }
    set menuBarVisible(visible: boolean) {
      this.setMenuBarVisibility(visible);
    }
    get fullScreen() {
      return this.isFullScreen();
    }
    set fullScreen(flag: boolean) {
      this.setFullScreen(flag);
    }
    get simpleFullScreen() {
      return this.isSimpleFullScreen();
    }
    set simpleFullScreen(flag: boolean) {
      this.setSimpleFullScreen(flag);
    }
    get fullScreenable() {
      return this.isFullScreenable();
    }
    set fullScreenable(flag: boolean) {
      this.setFullScreenable(flag);
    }
    get kiosk() {
      return this.isKiosk();
    }
    set kiosk(flag: boolean) {
      this.setKiosk(flag);
    }
    get resizable() {
      return this.isResizable();
    }
    set resizable(flag: boolean) {
      this.setResizable(flag);
    }
    get visibleOnAllWorkspaces() {
      return this.isVisibleOnAllWorkspaces();
    }
    set visibleOnAllWorkspaces(flag: boolean) {
      this.setVisibleOnAllWorkspaces(flag);
    }
    get shadow() {
      return this.hasShadow();
    }
    set shadow(flag: boolean) {
      this.setHasShadow(flag);
    }

    /** Tells the engine the menu bar as it is now, once the window is open. */
    readonly #showMenuBar = () => {
      if (this.opened && !this.destroyed) {
        toEngine({
          auto_hide: this.#menuBarAutoHide,
          menu: this.#menu === null ? null : menus.model(this.#menu),
          type: "set_menu_bar",
          visible: this.#menuBarVisible,
          window: this.id,
        });
      }
    };

    /** Tells the engine where the window's open views go, if that changed. */
    readonly placeViews = () => {
      if (this.opened && !this.destroyed) {
        const views = this.contentView.children.flatMap(
          (view) => view.placement() ?? [],
        );
        const placed = JSON.stringify(views);
        if (placed !== this.#placed) {
          this.#placed = placed;
          toEngine({ type: "set_views", views, window: this.id });
        }
      }
    };

    protected override wasOpened() {
      this.placeViews();
      // A window opens with no menu bar, so there's only one to tell of.
      if (this.#menu !== null) {
        this.#showMenuBar();
      }
    }

    protected override menuClicked(command: number) {
      if (this.#menu !== null) {
        menus.click(this.#menu, command, this.id);
      }
    }

    protected override wasLoaded() {
      if (!this.#shown) {
        this.#shown = true;
        this.emit("ready-to-show");
      }
    }

    protected override titled(title: string) {
      const titleEvent = eventObject();
      this.emit("page-title-updated", titleEvent, title, false);
      if (!titleEvent.defaultPrevented) {
        this.setTitle(title);
      }
    }

    protected override opening() {
      return {
        title: this.title,
        ...(this.#hidden ? { hidden: true as const } : {}),
      };
    }

    /** The user's close goes through the app's `close` listeners. */
    protected override closeAsked() {
      this.close();
    }

    protected override resized(width: number, height: number) {
      const from = this.#size;
      this.#size = { height, width };
      for (const view of this.getBrowserViews()) {
        view.follow(from, this.#size);
      }
      this.emit("resize");
    }

    protected override wasClosed() {
      windows.delete(this.id);
      this.#menu?.off("changed", this.#showMenuBar);
      // The engine lets go of the window's views; they live on unheld.
      for (const view of this.contentView.children) {
        view.holder = undefined;
      }
      this.emit("closed");
      if (windows.size === 0) {
        allClosed();
      }
    }
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
    pages.get(event.window)?.take(event);
  });

  /** Electron's `webContents` module: the app's pages. */
  const webContents = {
    fromId: (id: number) => pages.get(id)?.webContents,
    getAllWebContents: () =>
      [...pages.values()]
        .filter((page) => !page.isDestroyed())
        .map((page) => page.webContents),
    getFocusedWebContents: () => null,
  };

  return {
    BrowserView,
    BrowserWindow,
    WebContents,
    WebContentsView,
    WebFrameMain,
    webContents,
    /** The page the engine numbers `window`, a window's or a view's. */
    webContentsOf: (window: number) => pages.get(window)?.webContents,
  };
};

type Windows = ReturnType<typeof createBrowserWindow>;
export type BrowserWindow = InstanceType<Windows["BrowserWindow"]>;
export type WebContentsView = InstanceType<Windows["WebContentsView"]>;
export type BrowserView = InstanceType<Windows["BrowserView"]>;
