// The controller for the simple reference chrome.
//
// Responsibilities kept deliberately tiny and DOM-testable: when the host
// announces an app, mount an `<domicile-app>` onto the stage; when it closes,
// unmount it. Everything about *how* the app looks (rounding, blur, layout) is
// plain CSS in the shell's stylesheet — that is the whole point of Domicile.

import { registerElements } from "@domicile/chrome-sdk";

export class ShellController {
  /**
   * @param {import("@domicile/chrome-sdk").BridgeClient} bridge
   * @param {{root: Element, register?: (bridge: any) => void}} opts
   */
  constructor(bridge, { root, register = registerElements } = {}) {
    this.bridge = bridge;
    this.root = root;
    this.apps = new Map();

    register(bridge);
    bridge.on("app_appeared", (m) => this.mountApp(m));
    bridge.on("app_closed", (m) => this.unmountApp(m));
    bridge.on("app_frame", (m) => this.drawFrame(m));
  }

  drawFrame({ app_id, width, height, data }) {
    const el = this.apps.get(app_id);
    if (el && typeof el.drawFrame === "function") el.drawFrame(width, height, data);
  }

  /** Install the shell's keybindings on an event target (default: document). */
  installKeybindings(target = document) {
    target.addEventListener("keydown", (e) => this.handleKeydown(e));
  }

  handleKeydown(e) {
    // Alt + Enter -> a terminal; add Shift for a Google webview.
    if (!(e.altKey && e.key === "Enter")) return;
    e.preventDefault();
    if (e.shiftKey) {
      this.openWebview("https://www.google.com");
    } else {
      this.bridge.spawn(["kitty"]);
    }
  }

  /** Mount a webview portal onto the stage. */
  openWebview(src) {
    const el = document.createElement("domicile-webview");
    el.className = "app";
    el.setAttribute("src", src);
    this.root.appendChild(el);
    return el;
  }

  mountApp({ app_id }) {
    if (this.apps.has(app_id)) return this.apps.get(app_id);
    const el = document.createElement("domicile-app");
    el.setAttribute("app-id", app_id);
    el.className = "app";
    this.root.appendChild(el);
    this.apps.set(app_id, el);
    return el;
  }

  unmountApp({ app_id }) {
    const el = this.apps.get(app_id);
    if (el) {
      el.remove();
      this.apps.delete(app_id);
    }
  }
}
