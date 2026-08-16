import { beforeEach, describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";

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
  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
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

describe("ShellController", () => {
  let bridge: FakeBridge;
  let root: HTMLElement;
  let controller: ShellController;

  beforeEach(() => {
    document.body.innerHTML = '<div id="stage"></div>';
    const stage = document.querySelector("#stage");
    if (stage === null) {
      throw new Error("test setup: #stage is missing");
    }
    root = stage as HTMLElement;
    bridge = new FakeBridge();
    controller = new ShellController(bridge as unknown as BridgeClient, {
      register: (bound) => {
        registerElements(bound, { measure: stubMeasure });
      },
      root,
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

      bridge.emit("app_frame", {
        app_id: "term",
        data: "AAECAwQFBgc=",
        format: "rgba",
        height: 1,
        width: 2,
      });
      expect(drawn).toEqual([[2, 1, "AAECAwQFBgc="]]);
    });

    it("drops a frame for an app it never mounted", () => {
      expect(() => {
        bridge.emit("app_frame", {
          app_id: "ghost",
          data: "AA==",
          height: 1,
          width: 1,
        });
      }).not.toThrow();
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
