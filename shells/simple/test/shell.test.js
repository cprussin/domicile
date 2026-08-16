// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { registerElements } from "@loom/chrome-sdk";
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

  it("mounts an <loom-app> when an app appears", () => {
    bridge.emit("app_appeared", { app_id: "term", title: "Terminal", size: [640, 480] });
    const el = root.querySelector("loom-app");
    expect(el).not.toBeNull();
    expect(el.getAttribute("app-id")).toBe("term");
  });

  it("does not mount the same app twice", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    expect(root.querySelectorAll("loom-app")).toHaveLength(1);
  });

  it("unmounts the app when it closes", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_closed", { app_id: "term" });
    expect(root.querySelector("loom-app")).toBeNull();
  });

  it("supports several concurrent apps", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    bridge.emit("app_appeared", { app_id: "editor", size: [1, 1] });
    expect(root.querySelectorAll("loom-app")).toHaveLength(2);

    bridge.emit("app_closed", { app_id: "term" });
    const remaining = [...root.querySelectorAll("loom-app")].map((e) => e.getAttribute("app-id"));
    expect(remaining).toEqual(["editor"]);
  });

  it("mounting a connected <loom-app> reports its portal to the host", () => {
    bridge.emit("app_appeared", { app_id: "term", size: [1, 1] });
    // Appending a connected element triggers the SDK's place-portal path.
    expect(bridge.calls.some(([kind, p]) => kind === "place" && p.appId === "term")).toBe(true);
  });
});
