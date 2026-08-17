import { beforeEach, describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";

import { ShellController } from "./shell-controller";

type Call = readonly [kind: string, ...args: unknown[]];

// A double that both records portal calls and emits host events.
class FakeBridge {
  readonly calls: Call[] = [];

  readonly #handlers = new Map<string, (message: unknown) => void>();

  on(type: string, handler: (message: never) => void): this {
    this.#handlers.set(type, handler as (message: unknown) => void);
    return this;
  }

  emit(type: string, message: Record<string, unknown>): void {
    this.#handlers.get(type)?.({ type, ...message });
  }

  placePortal(placement: { appId: string }): void {
    this.calls.push(["place", placement]);
  }
  removePortal(appId: string): void {
    this.calls.push(["remove", appId]);
  }
  resizeApp(appId: string, size: readonly number[]): void {
    this.calls.push(["resize", appId, size]);
  }
  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
  }
  focusApp(appId: string): void {
    this.calls.push(["focusApp", appId]);
  }
  focusChrome(): void {
    this.calls.push(["focusChrome"]);
  }
}

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

const keydown = (props: Partial<KeyboardEventInit>): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: "", ...props });

const tabs = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];

const tabLabels = (): (string | null)[] => tabs().map((tab) => tab.textContent);

const activeTab = (): string | null | undefined =>
  tabs().find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent;

const shownWindows = (root: Element): (string | null)[] =>
  [...root.children]
    .filter((element) => !element.hasAttribute("hidden"))
    .map((element) => element.getAttribute("app-id") ?? element.className);

describe("ShellController", () => {
  let bridge: FakeBridge;
  let root: HTMLElement;
  let controller: ShellController;

  beforeEach(() => {
    document.body.innerHTML = '<div id="tabs"></div><div id="stage"></div>';
    const stage = document.querySelector("#stage");
    const tabBar = document.querySelector("#tabs");
    if (stage === null || tabBar === null) {
      throw new Error("test setup: #stage or #tabs is missing");
    }
    root = stage as HTMLElement;
    bridge = new FakeBridge();
    controller = new ShellController(bridge as unknown as BridgeClient, {
      register: (bound) => {
        registerElements(bound, { measure: stubMeasure });
      },
      root,
      tabs: tabBar,
    });
  });

  describe("app portals", () => {
    it("mounts a <domicile-app> when an app appears", () => {
      bridge.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: "Terminal",
      });
      expect(root.querySelector(APP_TAG_NAME)?.getAttribute("app-id")).toBe(
        "term",
      );
    });

    it("does not mount the same app twice", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      bridge.emit("app_appeared", { app_id: "term" });
      expect(root.querySelectorAll(APP_TAG_NAME)).toHaveLength(1);
    });

    it("unmounts the app when it closes", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      bridge.emit("app_closed", { app_id: "term" });
      expect(root.querySelector(APP_TAG_NAME)).toBeNull();
    });

    it("supports several concurrent apps", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      bridge.emit("app_appeared", { app_id: "editor" });
      bridge.emit("app_closed", { app_id: "term" });

      const remaining = [...root.querySelectorAll(APP_TAG_NAME)].map(
        (element) => element.getAttribute("app-id"),
      );
      expect(remaining).toEqual(["editor"]);
    });

    it("reports a mounted portal to the host", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      expect(bridge.calls).toContainEqual([
        "place",
        {
          appId: "term",
          size: [100, 100],
          transform: [1, 0, 0, 1, 0, 0],
          visible: true,
          zIndex: 0,
        },
      ]);
    });
  });

  describe("frames", () => {
    it("routes app_frame to the matching app element", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      const element = root.querySelector(APP_TAG_NAME) as DomicileAppElement;
      const drawn: unknown[] = [];
      element.drawFrame = (width, height, data) => {
        drawn.push([width, height, data]);
      };

      const pixels = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      bridge.emit("app_frame", {
        app_id: "term",
        bytes: pixels.length,
        format: "rgba",
        height: 1,
        pixels,
        width: 2,
      });
      expect(drawn).toEqual([[2, 1, pixels]]);
    });

    it("drops a frame for an app it never mounted", () => {
      expect(() => {
        bridge.emit("app_frame", {
          app_id: "ghost",
          bytes: 1,
          height: 1,
          pixels: new Uint8Array([0]),
          width: 1,
        });
      }).not.toThrow();
    });
  });

  describe("client-driven appearance", () => {
    it("tracks a client's new content size on its element", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      const element = root.querySelector(APP_TAG_NAME) as DomicileAppElement;
      const sizes: unknown[] = [];
      element.setSurfaceSize = (width, height) => {
        sizes.push([width, height]);
      };

      bridge.emit("app_resized", { app_id: "term", size: [800, 600] });
      expect(sizes).toEqual([[800, 600]]);
    });

    it("applies a cursor the client asked for", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      bridge.emit("app_cursor", { app_id: "term", cursor: "text" });

      const element = root.querySelector(APP_TAG_NAME) as DomicileAppElement;
      expect(element.style.cursor).toBe("text");
    });

    it("ignores appearance messages for an app it never mounted", () => {
      expect(() => {
        bridge.emit("app_resized", { app_id: "ghost", size: [1, 1] });
        bridge.emit("app_cursor", { app_id: "ghost", cursor: "wait" });
      }).not.toThrow();
    });
  });

  describe("windows and tabs", () => {
    it("shows the window that just opened and hides the others", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_appeared", { app_id: "editor", title: "Editor" });

      expect(tabLabels()).toEqual(["Terminal", "Editor"]);
      expect(activeTab()).toBe("Editor");
      expect(shownWindows(root)).toEqual(["editor"]);
    });

    it("falls back to the app id when a client offers no title", () => {
      bridge.emit("app_appeared", { app_id: "term" });
      expect(tabLabels()).toEqual(["term"]);
    });

    it("shows the window whose tab is clicked", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_appeared", { app_id: "editor", title: "Editor" });

      tabs()[0]?.click();
      expect(activeTab()).toBe("Terminal");
      expect(shownWindows(root)).toEqual(["term"]);
    });

    it("hands the keyboard to the client whose window takes the stage", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_appeared", { app_id: "editor", title: "Editor" });
      expect(bridge.calls).toContainEqual(["focusApp", "editor"]);

      bridge.calls.length = 0;
      tabs()[0]?.click();
      expect(bridge.calls).toContainEqual(["focusApp", "term"]);
    });

    it("hands the keyboard to a browser window's page", () => {
      controller.openBrowser("https://example.com");
      const view = root.querySelector(WEBVIEW_TAG_NAME);
      if (view === null) {
        throw new Error("test setup: the browser window embedded no webview");
      }
      const focused: string[] = [];
      Object.assign(view, { focus: () => focused.push("page") });

      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      tabs()[0]?.click();
      expect(focused).toEqual(["page"]);
    });

    it("hands the stage to another window when the shown one closes", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_appeared", { app_id: "editor", title: "Editor" });

      bridge.emit("app_closed", { app_id: "editor" });
      expect(tabLabels()).toEqual(["Terminal"]);
      expect(activeTab()).toBe("Terminal");
      expect(shownWindows(root)).toEqual(["term"]);
    });

    it("leaves the stage empty once the last window closes", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_closed", { app_id: "term" });

      expect(tabLabels()).toEqual([]);
      expect(root.children).toHaveLength(0);
    });

    it("keeps the shown window when a background one closes", () => {
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_appeared", { app_id: "editor", title: "Editor" });

      bridge.emit("app_closed", { app_id: "term" });
      expect(activeTab()).toBe("Editor");
      expect(shownWindows(root)).toEqual(["editor"]);
    });
  });

  describe("launchers", () => {
    it("opens a terminal on the compositor", () => {
      controller.openTerminal();
      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("opens a browser window with an address bar, tabbed by site", () => {
      controller.openBrowser("https://example.com/docs");

      expect(tabLabels()).toEqual(["example.com"]);
      expect(activeTab()).toBe("example.com");
      const view = root.querySelector(WEBVIEW_TAG_NAME);
      expect(view?.getAttribute("src")).toBe("https://example.com/docs");
      expect(root.querySelector('input[aria-label="Address"]')).not.toBeNull();
    });

    it("retitles a browser tab as its page navigates", () => {
      controller.openBrowser("https://example.com");
      const view = root.querySelector(WEBVIEW_TAG_NAME);

      view?.dispatchEvent(
        new CustomEvent(WEBVIEW_NAVIGATE_EVENT, {
          detail: { url: "https://docs.example.com/page" },
        }),
      );
      expect(tabLabels()).toEqual(["docs.example.com"]);
    });
  });

  describe("keybindings", () => {
    it("Alt+Enter spawns a terminal", () => {
      controller.handleKeydown(keydown({ altKey: true, key: "Enter" }));
      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("Alt+Shift+Enter opens a webview on the stage", () => {
      controller.handleKeydown(
        keydown({ altKey: true, key: "Enter", shiftKey: true }),
      );
      const view = root.querySelector(WEBVIEW_TAG_NAME);
      expect(view?.getAttribute("src")).toContain("google.com");
      expect(bridge.calls.some(([kind]) => kind === "spawn")).toBe(false);
    });

    it("ignores Enter without Alt", () => {
      controller.handleKeydown(keydown({ key: "Enter" }));
      expect(bridge.calls.some(([kind]) => kind === "spawn")).toBe(false);
      expect(root.querySelector(WEBVIEW_TAG_NAME)).toBeNull();
    });
  });
});
