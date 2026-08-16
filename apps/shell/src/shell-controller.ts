// The controller for the reference chrome.
//
// Responsibilities kept deliberately tiny and DOM-testable: when the host
// announces an app, mount an `<domicile-app>` onto the stage; when it closes,
// unmount it. Everything about *how* the app looks (rounding, blur, layout) is
// plain CSS in the shell's stylesheet — that is the whole point of Domicile.

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type {
  AppAppearedMessage,
  AppClosedMessage,
  AppFrameMessage,
} from "@domicile/chrome-sdk/protocol";
import {
  APP_TAG_NAME,
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";

/** The class the stylesheet hangs an app portal's appearance off. */
const PORTAL_CLASS = "app";

/** Where Alt+Shift+Enter points its demo webview. */
const DEMO_WEBVIEW_URL = "https://www.google.com";

/** What Alt+Enter asks the compositor to launch. */
const TERMINAL_COMMAND = ["kitty"] as const;

export type ShellOptions = {
  root: Element;
  /**
   * Injected by tests that bind the SDK's custom elements to their own bridge
   * double. Defaults to the real registration.
   */
  register?: (bridge: BridgeClient) => void;
};

export class ShellController {
  readonly #bridge: BridgeClient;
  readonly #root: Element;
  readonly #apps = new Map<string, DomicileAppElement>();

  constructor(
    bridge: BridgeClient,
    { root, register = registerElements }: ShellOptions,
  ) {
    this.#bridge = bridge;
    this.#root = root;

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
  }

  /** Install the shell's keybindings on an event target. */
  installKeybindings(target: EventTarget = document): void {
    target.addEventListener("keydown", (event) => {
      this.handleKeydown(event as KeyboardEvent);
    });
  }

  // Alt+Enter -> a terminal; add Shift for a webview.
  handleKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        this.openWebview(DEMO_WEBVIEW_URL);
      } else {
        this.#bridge.spawn(TERMINAL_COMMAND);
      }
    }
  }

  /** Mount a webview portal onto the stage. */
  openWebview(src: string): Element {
    const element = document.createElement(WEBVIEW_TAG_NAME);
    element.className = PORTAL_CLASS;
    element.setAttribute("src", src);
    this.#root.append(element);
    return element;
  }

  mountApp({ app_id }: Pick<AppAppearedMessage, "app_id">): DomicileAppElement {
    const existing = this.#apps.get(app_id);
    if (existing === undefined) {
      const element = document.createElement(
        APP_TAG_NAME,
      ) as DomicileAppElement;
      element.setAttribute("app-id", app_id);
      element.className = PORTAL_CLASS;
      this.#root.append(element);
      this.#apps.set(app_id, element);
      return element;
    } else {
      return existing;
    }
  }

  unmountApp({ app_id }: Pick<AppClosedMessage, "app_id">): void {
    const element = this.#apps.get(app_id);
    if (element !== undefined) {
      element.remove();
      this.#apps.delete(app_id);
    }
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
}
