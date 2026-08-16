// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { registerElements } from "@domicile/chrome-sdk";
import { ShellController } from "../src/shell.js";

// A fake bridge that can both record portal calls and emit host events.
class FakeBridge {
  constructor() {
    this.handlers = new Map();
    this.calls = [];
  }
  on(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }
  emit(type, message) {
    this.handlers.get(type)?.({ type, ...message });
  }
  placePortal(p) {
    this.calls.push(["place", p]);
  }
  removePortal(id) {
    this.calls.push(["remove", id]);
  }
  spawn(command) {
    this.calls.push(["spawn", command]);
  }
}

function keydown(props) {
  return { preventDefault() {}, altKey: false, shiftKey: false, key: "", ...props };
}

const stubMeasure = () => ({ size: [100, 100], transform: [1, 0, 0, 1, 0, 0], zIndex: 0, visible: true });

describe("ShellController", () => {
  let bridge;
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="stage"></div>';
    root = document.getElementById("stage");
    bridge = new FakeBridge();
    // Bind the custom elements to this bridge with an injected measure.
    new ShellController(bridge, {
      root,
      register: (b) => registerElements(b, { measure: stubMeasure }),
    });
  });

  it("mounts an <domicile-app> when an app appears", () => {
    bridge.emit("app_appeared", { app_id: "term", title: "Terminal", size: [640, 480] });
    const el = root.querySelector("domicile-app");
    expect(el).not.toBeNull();
    expect(el.getAttribute("app-id")).toBe("term");
  });

  it("does not mount the same app twice", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    expect(root.querySelectorAll("domicile-app")).toHaveLength(1);
  });

  it("unmounts the app when it closes", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_closed", { app_id: "term" });
    expect(root.querySelector("domicile-app")).toBeNull();
  });

  it("supports several concurrent apps", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_appeared", { app_id: "editor", size: [1, 1] });
    expect(root.querySelectorAll("domicile-app")).toHaveLength(2);

    bridge.emit("app_closed", { app_id: "term" });
    const remaining = [...root.querySelectorAll("domicile-app")].map((e) => e.getAttribute("app-id"));
    expect(remaining).toEqual(["editor"]);
  });

  it("mounting a connected <domicile-app> reports its portal to the host", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    // Appending a connected element triggers the SDK's place-portal path.
    expect(bridge.calls.some(([kind, p]) => kind === "place" && p.appId === "term")).toBe(true);
  });

  it("routes app_frame to the matching app element", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    const el = root.querySelector("domicile-app");
    const drawn = [];
    el.drawFrame = (w, h, data) => drawn.push([w, h, data]);

    bridge.emit("app_frame", { app_id: "term", width: 2, height: 1, format: "rgba", data: "AAECAwQFBgc=" });
    expect(drawn).toEqual([[2, 1, "AAECAwQFBgc="]]);

    // A frame for an unknown app is a no-op (no throw).
    expect(() => bridge.emit("app_frame", { app_id: "ghost", width: 1, height: 1, data: "AA==" })).not.toThrow();
  });

  it("Alt+Enter spawns a terminal", () => {
    const controller = new ShellController(bridge, { root, register: () => {} });
    controller.handleKeydown(keydown({ altKey: true, key: "Enter" }));
    expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
  });

  it("Alt+Shift+Enter opens a Google webview on the stage", () => {
    const controller = new ShellController(bridge, { root, register: () => {} });
    controller.handleKeydown(keydown({ altKey: true, shiftKey: true, key: "Enter" }));
    const view = root.querySelector("domicile-webview");
    expect(view).not.toBeNull();
    expect(view.getAttribute("src")).toContain("google.com");
    // It did not spawn a process.
    expect(bridge.calls.some(([k]) => k === "spawn")).toBe(false);
  });

  it("ignores Enter without Alt", () => {
    const controller = new ShellController(bridge, { root, register: () => {} });
    controller.handleKeydown(keydown({ key: "Enter" }));
    expect(bridge.calls.some(([k]) => k === "spawn")).toBe(false);
    expect(root.querySelector("domicile-webview")).toBeNull();
  });
});
