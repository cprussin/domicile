import { beforeEach, describe, expect, it } from "bun:test";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";
import type { Display } from "@domicile/component-library/display-source";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { AppElements } from "./app-elements";
import type { Chord } from "./chord";
import { displaysFrom } from "./display-source";
import { Shell } from "./Shell";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = {
  name: "right",
  position: [1920, 0],
  scale: 1,
  size: [1280, 1024],
};

/** The region a `<Screen>` renders for the display of this name. */
const screenNamed = (container: HTMLElement, name: string): Element | null =>
  container.querySelector(`[data-screen="${name}"]`);

type Call = readonly [kind: string, ...args: unknown[]];

// A double that both records what the chrome asks of the host and emits the
// host events the chrome reacts to.
class FakeBridge {
  readonly calls: Call[] = [];

  /**
   * The desktop, retained the way the real bridge retains it: a description is
   * a fact rather than an event, and the chrome reads it as often as it is
   * told it.
   */
  displays: readonly Display[] | undefined;

  readonly #handlers = new Map<string, (message: unknown) => void>();

  on(type: string, handler: (message: never) => void): this {
    this.#handlers.set(type, handler as (message: unknown) => void);
    return this;
  }

  // Only if it is still the registered one: `on` is a single slot, so a
  // teardown that removed whatever it found could silence the handler that
  // displaced it.
  off(type: string, handler: (message: never) => void): this {
    if (this.#handlers.get(type) === handler) {
      this.#handlers.delete(type);
    }
    return this;
  }

  /** The host describing the desktop, which it does at least once. */
  describes(displays: readonly Display[]): void {
    this.displays = displays;
    this.emit("displays", { displays });
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
  closeApp(appId: string): void {
    this.calls.push(["closeApp", appId]);
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

/**
 * Renders the chrome on a desktop of `desktop`.
 *
 * Described *before* the first render by default, the way a shell that has
 * completed its handshake is: the chrome renders nothing until there is a
 * desktop to put it on. The tests that care about the gap pass `undefined` and
 * describe one themselves.
 */
const renderingShell = (desktop: readonly Display[] | undefined) => {
  bridge = new FakeBridge();
  bridge.displays = desktop;
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
  return render(
    <Shell
      appElements={new AppElements()}
      bridge={client}
      displays={displaysFrom(client)}
    />,
  );
};

/** The chrome on a desktop the host has already described. */
const renderShell = (desktop: readonly Display[] = [LEFT]) =>
  renderingShell(desktop);

/**
 * The chrome before any desktop has been described — the gap between the page
 * loading and the host answering, and the whole of a shell that has no host.
 *
 * Its own function rather than `renderUndescribedShell()`, which a default
 * parameter would quietly turn back into a described desktop.
 */
const renderUndescribedShell = () => renderingShell(undefined);

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
  delete window.domicileWindow;
});

describe("Shell", () => {
  describe("across the displays", () => {
    it("puts the chrome on the first display the host named", () => {
      // Not on a name of the shell's choosing: the names are the user's, out
      // of the config, and the shell has never seen it.
      const { container } = renderShell([LEFT, RIGHT]);

      expect(
        screenNamed(container, "left")?.querySelector("main"),
      ).toBeInTheDocument();
      expect(screenNamed(container, "right")?.querySelector("main")).toBeNull();
    });

    it("puts a clock on every other display", () => {
      // An empty region and a region that is not there look identical, so the
      // screens without the chrome on them have to show something.
      const { container } = renderShell([LEFT, RIGHT]);

      expect(screenNamed(container, "right")).toHaveTextContent(/\d/);
    });

    it("says so when the host describes a desktop with no screens", () => {
      // `undefined` and `[]` are different things, and without this they look
      // identical from the outside: a blank window. The `domicile` daemon
      // serves the chrome protocol from a bare `Session` and describes no
      // displays at all, so this is what a chrome pointed at it gets.
      renderShell([]);

      expect(
        screen.getByRole("heading", { name: "No screens" }),
      ).toBeInTheDocument();
    });

    it("says nothing of the kind before the host has described anything", () => {
      // Not having been told yet is a moment, not a desktop with no screens on
      // it — and a "no screens" card for the length of the handshake would be
      // on screen every time the shell starts.
      renderUndescribedShell();

      expect(
        screen.queryByRole("heading", { name: "No screens" }),
      ).not.toBeInTheDocument();
    });

    it("renders nothing until the desktop is described", () => {
      // A chrome laid out over the page and then moved onto a screen is two
      // different elements in that slot, and the switch takes the whole
      // subtree with it. Waiting costs the handshake's worth of blank window;
      // a shell that will never be told has `viewport-display` instead.
      const { container } = renderUndescribedShell();

      expect(container.querySelector("main")).toBeNull();
    });

    it("mounts the chrome once, over the windows already open", () => {
      // A chrome that reloads against a compositor with clients open is told
      // about them, and nothing makes the host answer the handshake first. A
      // chrome built before the desktop and rebuilt after it would take those
      // windows down with it — every portal re-created blank, every embedded
      // page reloaded to the URL its window was opened at.
      const { container } = renderUndescribedShell();
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });

      bridge.describes([LEFT]);

      expect(
        screenNamed(container, "left")?.querySelector(APP_TAG_NAME),
      ).toBeInTheDocument();
      expect(bridge.calls).not.toContainEqual(["remove", "term"]);
    });

    it("follows the desktop when it changes", () => {
      // The desktop is re-described whenever it changes — with no displays
      // configured it is Domicile's own window, so every resize produces
      // another description — and the chrome moves to whatever is first now.
      const { container } = renderShell([LEFT, RIGHT]);

      const stage = screenNamed(container, "left")?.querySelector("main");
      bridge.describes([RIGHT]);

      expect(
        screenNamed(container, "right")?.querySelector("main"),
      ).toBeInTheDocument();
      expect(screenNamed(container, "left")).toBeNull();
      // The same stage, moved, and not a new one: a chrome rebuilt on a
      // re-description reloads every embedded page to where it started and
      // re-creates every portal blank, with nothing on screen to show for it.
      expect(screenNamed(container, "right")?.querySelector("main")).toBe(
        stage ?? null,
      );
    });
  });

  describe("the window it is drawn in", () => {
    it("is sized to the whole desktop, not to one display", () => {
      // The page is the desktop, and the SDK places every portal from a
      // `getBoundingClientRect`. A window narrower than the desktop leaves the
      // right-hand screens off the end of the viewport, still laying out and
      // still reporting positions the compositor honours.
      const sizes: (readonly number[])[] = [];
      window.domicileWindow = {
        sizeToDesktop: (width, height) => {
          sizes.push([width, height]);
        },
      };

      renderShell([LEFT, RIGHT]);

      expect(sizes).toContainEqual([3200, 1080]);
    });

    it("is left alone for a desktop of no screens", () => {
      // `0 x 0` is not a window, and it is what the bounding box of nothing
      // comes to. The chrome renders nothing at all for that same desktop, so
      // a window resized to nothing would be the one part of the shell acting
      // on it.
      const sizes: (readonly number[])[] = [];
      window.domicileWindow = {
        sizeToDesktop: (width, height) => {
          sizes.push([width, height]);
        },
      };

      renderShell([]);

      expect(sizes).toStrictEqual([]);
    });

    it("is left alone where there is no Electron host", () => {
      // The shell opened in a plain browser has no window of its own to size.
      // (Where Domicile composites this one the ask is made and not answered —
      // that is `main.ts`, which is the half that knows.)
      const { container } = renderUndescribedShell();

      expect(() => {
        bridge.describes([LEFT, RIGHT]);
      }).not.toThrow();
      expect(screenNamed(container, "left")).toBeInTheDocument();
    });
  });

  describe("filling the space it is given", () => {
    // A `<Screen>` is a region of the page at the display's own rectangle, so
    // everything inside it has to reach that rectangle's edges — nothing below
    // here has a size of its own to fall back on. This has come apart more than
    // once, and each time it looks the same from outside: content in a corner
    // of a screen that is the right size.
    //
    // Declarations rather than class names, because Panda hashes them: the
    // check is that the element carries *this rule*, which is what
    // `Screen.test.tsx` does for the region itself.

    it("gives the chrome the whole of the screen it is on", () => {
      const { container } = renderShell([LEFT]);
      const root = screenNamed(container, "left")?.firstElementChild;

      expect(root?.className).toContain(css({ blockSize: "100%" }));
    });

    it("gives the stage what the rail leaves of it", () => {
      const { container } = renderShell([LEFT]);
      const stage = screenNamed(container, "left")?.querySelector("main");

      expect(stage?.className).toContain(css({ flexGrow: 1 }));
    });

    it("gives a window the whole of the stage", () => {
      // The portal is a hole in the page and has no pixels of its own to size
      // it, so without this a client's surface is composited into whatever box
      // the element happened to get — which for an empty replaced element is
      // nothing at all.
      renderShell([LEFT]);
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });

      // One declaration per assertion: `css` with two of them returns two
      // space-joined class names, and Panda emits them in the source object's
      // key order — so a single `toContain` would need them adjacent and in
      // that order, and any declaration inserted between the two in
      // `window-styles.ts` would fail a rule that had not changed.
      const portal = document.querySelector(APP_TAG_NAME);
      expect(portal?.className).toContain(css({ position: "absolute" }));
      expect(portal?.className).toContain(css({ inset: 0 }));
    });

    it("gives an idle screen's clock the whole of that screen", () => {
      const { container } = renderShell([LEFT, RIGHT]);
      const idle = screenNamed(container, "right")?.firstElementChild;

      expect(idle?.className).toContain(css({ blockSize: "100%" }));
    });
  });

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

    it("does not cover a window that arrived already drawn with a placeholder", () => {
      // A size on the announcement is the replay a reloading chrome gets, and
      // the portal it mounts is never sent a frame or a resize where the
      // compositor draws the client itself — so the label would sit over a
      // live window. The portal mounts a render after the message, which is
      // why the size waits in `AppElements` rather than being applied on the
      // spot.
      const { container } = renderShell();
      bridge.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: "Terminal",
      });
      expect(container.querySelector(APP_TAG_NAME)?.classList).toContain(
        "has-surface",
      );
    });

    it("forgets what a client had drawn once it is gone", () => {
      // The record is the client's, so it ends with the client rather than
      // with the portal — a portal comes and goes for reasons the client knows
      // nothing about, and one kept for the session is one per window the
      // session ever opened. Observed by announcing the id a second time,
      // which the host will not do (its ids only count up); what is pinned is
      // that the drop happens on the close rather than on the unmount.
      const { container } = renderShell();
      bridge.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: "Terminal",
      });
      bridge.emit("app_closed", { app_id: "term" });
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      expect(container.querySelector(APP_TAG_NAME)?.classList).not.toContain(
        "has-surface",
      );
    });

    it("leaves the placeholder up for a client that has not drawn yet", () => {
      const { container } = renderShell();
      bridge.emit("app_appeared", { app_id: "term", title: "Terminal" });
      expect(container.querySelector(APP_TAG_NAME)?.classList).not.toContain(
        "has-surface",
      );
    });

    it("renames the tab when the client says what its window is called", () => {
      // The one place the wire message meets the reducer. A toplevel is
      // announced when the client creates it, which is before `set_title`, so
      // the tab opens showing the app id and is renamed afterwards.
      renderShell();
      bridge.emit("app_appeared", { app_id: "term", title: undefined });
      expect(tabNames()).toStrictEqual(["term"]);

      bridge.emit("app_titled", { app_id: "term", title: "~/domicile" });

      expect(tabNames()).toStrictEqual(["~/domicile"]);
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

    it("asks the client to close its window, and waits for it to go", async () => {
      // The client owns the window, so the X is a request: it stays on the
      // rail until the host says the client actually went away. A tab that
      // vanished on the click would take an editor's unsaved-work dialog off
      // the stage with nothing that ever puts it back.
      renderShell();
      bridge.emit("app_appeared", { app_id: "a", title: "A" });

      await userEvent.click(screen.getByRole("button", { name: "Close A" }));

      expect(bridge.calls).toContainEqual(["closeApp", "a"]);
      expect(tabNames()).toStrictEqual(["A"]);

      bridge.emit("app_closed", { app_id: "a" });
      expect(screen.queryAllByRole("listitem")).toStrictEqual([]);
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
