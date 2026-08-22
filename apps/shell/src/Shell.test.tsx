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
import type { Chord } from "./chord";
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
  native: true,
  opacity: 1,
  shadow: undefined,
  size: [100, 100],
  takesPointer: true,
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

// The Electron host's half of the guest shortcuts, as the preload injects it:
// what the page claims from the pages it embeds, and how a claimed press
// arrives when a `<webview>` swallowed the key.
class FakeGuestShortcuts {
  readonly claims: Chord[] = [];

  #pressed: ((chord: Chord) => void) | undefined;

  grab(chord: Chord): void {
    this.claims.push(chord);
  }

  onPressed(listener: (chord: Chord) => void): void {
    this.#pressed = listener;
  }

  press(chord: Chord): void {
    const pressed = this.#pressed;
    if (pressed === undefined) {
      throw new Error("nothing listened for a claimed press");
    } else {
      act(() => {
        pressed(chord);
      });
    }
  }
}

let bridge: FakeBridge;

const renderShell = () => {
  bridge = new FakeBridge();
  const client = bridge as unknown as BridgeClient;
  registerElements(client, {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves.
    },
  });
  return render(<Shell appElements={new AppElements()} bridge={client} />);
};

// The shell opened in a plain browser has no Electron host, so nothing
// installs this; the tests that want one put it back.
const renderHostedShell = () => {
  const host = new FakeGuestShortcuts();
  window.domicileGuestShortcuts = host;
  renderShell();
  return host;
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  delete window.domicileGuestShortcuts;
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

    it("claims Alt+Enter from the Electron host, with and without Shift", () => {
      // The compositor's claim covers a Wayland client holding the keyboard,
      // and not a page the chrome embeds: a `<webview>` is a browsing context
      // of its own, so its keys never reach this page. Where Domicile is not
      // the one dispatching them, the Electron host is what can take them.
      const host = renderHostedShell();

      expect(host.claims).toStrictEqual([
        { alt: true, ctrl: false, key: "Enter", meta: false, shift: false },
        { alt: true, ctrl: false, key: "Enter", meta: false, shift: true },
      ]);
    });

    it("opens a terminal when the host hands back a chord pressed in an embedded page", () => {
      const host = renderHostedShell();

      host.press({
        alt: true,
        ctrl: false,
        key: "Enter",
        meta: false,
        shift: false,
      });

      expect(bridge.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("opens a browser when the host's chord carries Shift", () => {
      // The shift is read off the chord the host delivered, not off the one
      // key this page could have heard for itself.
      const host = renderHostedShell();

      host.press({
        alt: true,
        ctrl: false,
        key: "Enter",
        meta: false,
        shift: true,
      });

      expect(tabNames()).toStrictEqual(["www.google.com"]);
    });

    it("opens one terminal for a held Alt+Enter, not one per repeat", async () => {
      // A held key repeats tens of times a second. The other two paths deliver
      // one press — the compositor never sees a repeat, and the host takes
      // them out of a guest's stream — and a page that opened a window for
      // each would be the only one that did.
      renderShell();
      await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
      const repeat = new KeyboardEvent("keydown", {
        altKey: true,
        cancelable: true,
        key: "Enter",
        repeat: true,
      });
      act(() => {
        document.dispatchEvent(repeat);
      });

      expect(bridge.calls.filter(([kind]) => kind === "spawn")).toHaveLength(1);
      // Answered by nobody, but still not passed on: the chord belongs to the
      // desktop for as long as it is held, which is what the other two paths
      // do with a repeat.
      expect(repeat.defaultPrevented).toBe(true);
    });

    it("leaves a chord the desktop never claimed alone", async () => {
      // The page hears every key, so it is the one path that can answer a
      // combination nobody claimed. Neither of these is Alt+Enter to the
      // compositor or to the host, and neither is one here either.
      renderShell();
      await userEvent.keyboard("{Control>}{Alt>}{Enter}{/Alt}{/Control}");
      await userEvent.keyboard("{Meta>}{Alt>}{Enter}{/Alt}{/Meta}");

      expect(bridge.calls).not.toContainEqual(["spawn", ["kitty"]]);
    });

    it("opens a browser on Alt+Shift+Enter", async () => {
      renderShell();
      await userEvent.keyboard("{Alt>}{Shift>}{Enter}{/Shift}{/Alt}");
      expect(tabNames()).toStrictEqual(["www.google.com"]);
    });
  });
});
