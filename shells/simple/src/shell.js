// The controller for the simple reference chrome.
//
// Responsibilities kept deliberately tiny and DOM-testable: when the host
// announces an app, mount an `<loom-app>` onto the stage; when it closes,
// unmount it. Everything about *how* the app looks (rounding, blur, layout) is
// plain CSS in the shell's stylesheet — that is the whole point of Loom.

import { registerElements } from "@loom/chrome-sdk";

export class ShellController {
  /**
   * @param {import("@loom/chrome-sdk").BridgeClient} bridge
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

  mountApp({ app_id }) {
    if (this.apps.has(app_id)) return this.apps.get(app_id);
    const el = document.createElement("loom-app");
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
