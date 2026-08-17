// The controller for the reference chrome.
//
// Responsibilities kept deliberately tiny and DOM-testable: it owns the windows
// on the stage — a `<domicile-app>` for every Wayland client the host announces,
// a browser window for every `openBrowser` — shows one of them at a time, and
// keeps the tab bar in step so the rest stay reachable. Everything about *how* a
// window looks (layout, chrome, decoration) is plain CSS in the shell's
// stylesheet — that is the whole point of Domicile.

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type {
  AppAppearedMessage,
  AppClosedMessage,
  AppCursorMessage,
  AppFrameMessage,
  AppResizedMessage,
} from "@domicile/chrome-sdk/protocol";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";

import { createBrowserWindow } from "./browser-window";
import { TabBar } from "./tab-bar";

/** The classes the stylesheet hangs an app window's appearance off. */
const APP_WINDOW_CLASS = "window app";

/** Where a browser window starts. */
const HOME_PAGE = "https://www.google.com";

/** What the terminal launcher asks the compositor to run. */
const TERMINAL_COMMAND = ["kitty"] as const;

export type ShellOptions = {
  root: Element;
  tabs: Element;
  /**
   * Injected by tests that bind the SDK's custom elements to their own bridge
   * double. Defaults to the real registration.
   */
  register?: (bridge: BridgeClient) => void;
};

export class ShellController {
  readonly #bridge: BridgeClient;
  readonly #root: Element;
  readonly #tabs: TabBar;
  readonly #apps = new Map<string, DomicileAppElement>();
  readonly #windows = new Map<string, HTMLElement>();
  #shown: string | undefined;
  #browsersOpened = 0;

  constructor(
    bridge: BridgeClient,
    { root, tabs, register = registerElements }: ShellOptions,
  ) {
    this.#bridge = bridge;
    this.#root = root;
    this.#tabs = new TabBar({
      onSelect: (id) => {
        this.#show(id);
      },
      root: tabs,
    });

    register(bridge);
    bridge.on("app_appeared", (message) => {
      this.mountApp(message);
    });
    bridge.on("app_closed", (message) => {
      this.unmountApp(message);
    });
    bridge.on("app_frame", (message) => {
      this.drawFrame(message);
    });
    bridge.on("app_resized", (message) => {
      this.resizeApp(message);
    });
    bridge.on("app_cursor", (message) => {
      this.applyCursor(message);
    });
  }

  /** Install the shell's keybindings on an event target. */
  installKeybindings(target: EventTarget = document): void {
    target.addEventListener("keydown", (event) => {
      this.handleKeydown(event as KeyboardEvent);
    });
  }

  // Alt+Enter -> a terminal; add Shift for a browser.
  handleKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        this.openBrowser();
      } else {
        this.openTerminal();
      }
    }
  }

  /** Ask the compositor to launch a terminal onto the stage. */
  openTerminal(): void {
    this.#bridge.spawn(TERMINAL_COMMAND);
  }

  /** Open a browser window on the stage and give it the stage. */
  openBrowser(src: string = HOME_PAGE): Element {
    this.#browsersOpened += 1;
    const id = `browser:${this.#browsersOpened.toString()}`;
    const element = createBrowserWindow({
      onNavigate: (url) => {
        this.#tabs.rename(id, siteOf(url));
      },
      src,
    });
    this.#openWindow(id, siteOf(src), element);
    return element;
  }

  mountApp({
    app_id,
    title,
  }: Pick<AppAppearedMessage, "app_id" | "title">): DomicileAppElement {
    const existing = this.#apps.get(app_id);
    if (existing === undefined) {
      const element = document.createElement(
        APP_TAG_NAME,
      ) as DomicileAppElement;
      element.setAttribute("app-id", app_id);
      element.className = APP_WINDOW_CLASS;
      this.#apps.set(app_id, element);
      this.#openWindow(appWindowId(app_id), title ?? app_id, element);
      return element;
    } else {
      return existing;
    }
  }

  unmountApp({ app_id }: Pick<AppClosedMessage, "app_id">): void {
    const element = this.#apps.get(app_id);
    if (element !== undefined) {
      this.#apps.delete(app_id);
      this.#closeWindow(appWindowId(app_id), element);
    }
  }

  // The client redrew at a new resolution; the element needs it to scale
  // pointer coordinates even before the first frame at that size arrives.
  resizeApp({
    app_id,
    size,
  }: Pick<AppResizedMessage, "app_id" | "size">): void {
    this.#apps.get(app_id)?.setSurfaceSize(size[0], size[1]);
  }

  applyCursor({
    app_id,
    cursor,
  }: Pick<AppCursorMessage, "app_id" | "cursor">): void {
    this.#apps.get(app_id)?.applyCursor(cursor);
  }

  // A frame for an app the shell never mounted is a no-op: the host may still
  // be draining frames for a portal this chrome has already torn down.
  drawFrame({
    app_id,
    width,
    height,
    data,
  }: Pick<AppFrameMessage, "app_id" | "width" | "height" | "data">): void {
    this.#apps.get(app_id)?.drawFrame(width, height, data);
  }

  // A window that opens takes the stage; whatever had it is a tab away.
  #openWindow(id: string, label: string, element: HTMLElement): void {
    this.#windows.set(id, element);
    this.#root.append(element);
    this.#tabs.open(id, label);
    this.#show(id);
  }

  // The stage goes to the most recently opened of the survivors, so closing a
  // window lands on the one the user was on before it.
  #closeWindow(id: string, element: HTMLElement): void {
    element.remove();
    this.#windows.delete(id);
    this.#tabs.close(id);
    if (this.#shown === id) {
      this.#shown = undefined;
      const next = [...this.#windows.keys()].at(-1);
      if (next !== undefined) {
        this.#show(next);
      }
    }
  }

  // Hiding is what takes an app's portal off the stage: a hidden element has no
  // box, so the SDK reports it to the host as no longer composited.
  #show(id: string): void {
    for (const [windowId, element] of this.#windows) {
      element.hidden = windowId !== id;
    }
    this.#tabs.activate(id);
    this.#shown = id;
  }
}

// Window ids are namespaced so a client can never collide with a browser
// window the shell opened itself.
const appWindowId = (appId: string): string => `app:${appId}`;

// A tab is labelled by the site it is showing, the way a browser's is.
const siteOf = (url: string): string => new URL(url).hostname;
