// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { registerElements } from "../src/elements.js";

// Fake bridge capturing portal lifecycle calls.
class FakeBridge {
  constructor() {
    this.calls = [];
  }
  placePortal(p) {
    this.calls.push(["place", p]);
  }
  removePortal(id) {
    this.calls.push(["remove", id]);
  }
}

// jsdom does no layout, so measurement is injected in tests.
const stubMeasure = () => ({ size: [10, 20], transform: [1, 0, 0, 1, 0, 0], zIndex: 0, visible: true });

describe("<loom-app> custom element", () => {
  let bridge;

  beforeEach(() => {
    document.body.innerHTML = "";
    bridge = new FakeBridge();
    // Idempotent: registerElements may be called once per test process.
    registerElements(bridge, { measure: stubMeasure });
  });

  it("places a portal when connected with an app-id", () => {
    const el = document.createElement("loom-app");
    el.setAttribute("app-id", "term");
    document.body.appendChild(el);

    const places = bridge.calls.filter(([k]) => k === "place");
    expect(places).toHaveLength(1);
    expect(places[0][1].appId).toBe("term");
    expect(places[0][1].size).toEqual([10, 20]);
  });

  it("removes the portal when disconnected", () => {
    const el = document.createElement("loom-app");
    el.setAttribute("app-id", "term");
    document.body.appendChild(el);
    el.remove();

    expect(bridge.calls).toContainEqual(["remove", "term"]);
  });

  it("does nothing without an app-id", () => {
    const el = document.createElement("loom-app");
    document.body.appendChild(el);
    expect(bridge.calls).toHaveLength(0);
  });

  it("re-places when the app-id changes", () => {
    const el = document.createElement("loom-app");
    el.setAttribute("app-id", "term");
    document.body.appendChild(el);
    bridge.calls.length = 0;

    el.setAttribute("app-id", "editor");
    expect(bridge.calls).toContainEqual(["remove", "term"]);
    const place = bridge.calls.find(([k]) => k === "place");
    expect(place[1].appId).toBe("editor");
  });

  it("exposes appId as a property", () => {
    const el = document.createElement("loom-app");
    el.setAttribute("app-id", "term");
    expect(el.appId).toBe("term");
  });

  it("drawFrame creates a canvas surface without throwing", () => {
    const el = document.createElement("loom-app");
    el.setAttribute("app-id", "term");
    document.body.appendChild(el);
    // jsdom has no 2d context, so this exercises the canvas-creation path and
    // must not throw even when drawing is unavailable.
    expect(() => el.drawFrame(2, 1, "AAECAwQFBgc=")).not.toThrow();
    expect(el.querySelector("canvas")).not.toBeNull();
  });
});

describe("<loom-webview> custom element", () => {
  beforeEach(() => {
    registerElements(new FakeBridge(), { measure: stubMeasure });
  });

  it("reflects src and embeds an inner view when connected", () => {
    const el = document.createElement("loom-webview");
    el.setAttribute("src", "https://example.com");
    document.body.appendChild(el);
    expect(el.src).toBe("https://example.com");
    const view = el.querySelector(".loom-webview-frame");
    expect(view).not.toBeNull();
    expect(view.getAttribute("src")).toBe("https://example.com");
  });
});
