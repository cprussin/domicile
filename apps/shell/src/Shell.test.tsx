import { beforeEach, describe, expect, it } from "bun:test";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppElements } from "./app-elements";
import { Shell } from "./Shell";

type Call = readonly [kind: string, ...args: unknown[]];

// A double that both records what the chrome asks of the host and emits the
// host events the chrome reacts to.
class FakeBridge {
  readonly calls: Call[] = [];

  readonly #handlers = new Map<string, (message: unknown) => void>();

  on(type: string, handler: (message: never) => void): this {
    this.#handlers.set(type, handler as (message: unknown) => void);
    return this;
  }

  emit(type: string, message: Record<string, unknown>): void {
    act(() => {
      this.#handlers.get(type)?.({ type, ...message });
    });
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
  grabShortcut(shortcut: unknown): void {
    this.calls.push(["grabShortcut", shortcut]);
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
  cornerRadius: 0,
  opacity: 1,
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

const tabNames = (): string[] =>
  screen.getAllByRole("listitem").map((row) => row.textContent ?? "");

const shownWindowIds = (container: HTMLElement): (string | null)[] =>
  [...(container.querySelector("main")?.children ?? [])]
    .filter((element) => !element.hasAttribute("hidden"))
    .map((element) => element.getAttribute("app-id") ?? element.tagName);

let bridge: FakeBridge;

const renderShell = () => {
  bridge = new FakeBridge();
  const client = bridge as unknown as BridgeClient;
  registerElements(client, { measure: stubMeasure });
  return render(<Shell appElements={new AppElements()} bridge={client} />);
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("Shell", () => {
  describe("with nothing open", () => {
    it("says how to open something", () => {
      renderShell();
      expect(
        screen.getByRole("heading", { name: "No windows yet" }),
      ).toBeInTheDocument();
    });
  });

  describe("app portals", () => {
    it("mounts a portal when the host announces an app", () => {
      const { container } = renderShell();
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      expect(
        container.querySelector(APP_TAG_NAME)?.getAttribute("app-id"),
      ).toBe("term");
      expect(tabNames()).toStrictEqual(["Terminal"]);
    });

    it("takes the portal down when the app closes", () => {
      const { container } = renderShell();
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      bridge.emit("app_closed", { app_id: "term" });
      expect(container.querySelector(APP_TAG_NAME)).toBeNull();
    });

    it("shows one window at a time, the newest of them", () => {
      const { container } = renderShell();
      bridge.emit("app_appeared", { app_id: "a", title: "A" });
      bridge.emit("app_appeared", { app_id: "b", title: "B" });
      expect(shownWindowIds(container)).toStrictEqual(["b"]);
    });
  });

  describe("the tab rail", () => {
    it("puts the window whose tab was clicked on the stage", async () => {
      const { container } = renderShell();
      bridge.emit("app_appeared", { app_id: "a", title: "A" });
      bridge.emit("app_appeared", { app_id: "b", title: "B" });
      await userEvent.click(screen.getByRole("button", { name: "A" }));
      expect(shownWindowIds(container)).toStrictEqual(["a"]);
    });

    it("does not offer to close a client's window — the client owns that", () => {
      renderShell();
      bridge.emit("app_appeared", { app_id: "a", title: "A" });
      expect(screen.queryByRole("button", { name: /^Close/ })).toBeNull();
    });
  });

  describe("launchers", () => {
    it("asks the compositor for a terminal", async () => {
      renderShell();
      await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("opens a browser window on the stage, with a tab that closes it", async () => {
      renderShell();
      await userEvent.click(screen.getByRole("button", { name: "New tab" }));
      expect(tabNames()).toStrictEqual(["www.google.com"]);
      await userEvent.click(
        screen.getByRole("button", { name: "Close www.google.com" }),
      );
      expect(screen.queryAllByRole("listitem")).toStrictEqual([]);
    });
  });

  describe("keybindings", () => {
    it("opens a terminal on Alt+Enter", async () => {
      renderShell();
      await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("claims Alt+Enter from the compositor, with and without Shift", () => {
      // The page only hears a keystroke while it holds the keyboard. Once a
      // window is on screen it does not, which is exactly when the user reaches
      // for the shortcut that opens another one — so the compositor has to be
      // asked to take these before the window is given them.
      renderShell();

      expect(bridge.calls).toContainEqual([
        "grabShortcut",
        { alt: true, ctrl: false, key: 28, logo: false, shift: false },
      ]);
      expect(bridge.calls).toContainEqual([
        "grabShortcut",
        { alt: true, ctrl: false, key: 28, logo: false, shift: true },
      ]);
    });

    it("opens a terminal when the compositor hands back a claimed Alt+Enter", () => {
      renderShell();

      bridge.emit("shortcut", {
        shortcut: {
          alt: true,
          ctrl: false,
          key: 28,
          logo: false,
          shift: false,
        },
        type: "shortcut",
      });

      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("opens a browser on Alt+Shift+Enter", async () => {
      renderShell();
      await userEvent.keyboard("{Alt>}{Shift>}{Enter}{/Shift}{/Alt}");
      expect(tabNames()).toStrictEqual(["www.google.com"]);
    });
  });
});
