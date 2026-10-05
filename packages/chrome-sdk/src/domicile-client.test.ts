import { beforeEach, describe, expect, it } from "bun:test";

import { DomicileClient } from "./domicile-client";
import type {
  DomicileAppEvent,
  DomicileBrowserWindow,
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
  DomicileShortcut,
  DomicileWindow,
} from "./domicile-host";
import { focusedApp } from "./element-context";
import { FilePreview } from "./file-preview";
import { focusApp } from "./focus-app";
import { BTN_LEFT } from "./input";
import { isClaimed } from "./shortcut-claims";
import type { Theme } from "./theme";
import type { TrayAction } from "./tray";

type Call = readonly [kind: string, ...args: unknown[]];

/** `DomicileAppEvent` fields, all optional. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent` with unset fields defaulted as the engine does: empty
 * strings, zeros and `false`.
 */
const appEvent = (type: string, fields: AppEventFields): DomicileAppEvent =>
  Object.assign(new Event(type), {
    appId: "",
    arrival: 0,
    grab: false,
    hasSize: false,
    height: 0,
    parentAppId: "",
    title: "",
    width: 0,
    x: 0,
    y: 0,
    ...fields,
  });

/**
 * A fake `window.domicile` that records calls and dispatches only to
 * listeners registered with `addEventListener`.
 *
 * Dispatching through real listeners checks that `DomicileClient` registers
 * them in its constructor. A custom registry, not an `EventTarget`, because
 * `EventTarget`'s listener type does not fit `DomicileHost` without a cast and
 * it swallows listener throws.
 */
class FakeHost implements DomicileHost {
  readonly calls: Call[] = [];

  /** `null` until the desktop is described, as in the engine. */
  displays: readonly DomicileDisplay[] | null = null;

  /** `null` until a brightness is reported, as in the engine. */
  brightness: number | null = null;
  readonly windows: readonly DomicileWindow[] = [];
  readonly focusedWindow: string | null = null;

  /** Null until the browser lists its windows, as in the fork. */
  browserWindows: readonly DomicileBrowserWindow[] | null = null;

  readonly #listeners = new Map<string, (event: never) => void>();

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void {
    this.#listeners.set(type, listener);
  }

  /** Dispatch an event to the registered listener, if any. */
  dispatch<T extends keyof DomicileHostEventMap>(
    type: T,
    event: DomicileHostEventMap[T],
  ): void {
    this.#listeners.get(type)?.(event as never);
  }

  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
  }
  searchFiles(query: string): void {
    this.calls.push(["searchFiles", query]);
  }
  previewFile(path: string): void {
    this.calls.push(["previewFile", path]);
  }
  searchApps(query: string): void {
    this.calls.push(["searchApps", query]);
  }
  copyClipboardEntry(entry: number): void {
    this.calls.push(["copyClipboardEntry", entry]);
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
  setTheme(theme: Theme): void {
    this.calls.push(["setTheme", theme]);
  }
  unlock(passphrase: string): void {
    this.calls.push(["unlock", passphrase]);
  }
  lock(): void {
    this.calls.push(["lock"]);
  }
  setBrightness(level: number): void {
    this.calls.push(["setBrightness", level]);
  }
  setAudioVolume(id: string, volume: number): void {
    this.calls.push(["setAudioVolume", id, volume]);
  }
  setAudioMuted(id: string, muted: boolean): void {
    this.calls.push(["setAudioMuted", id, muted]);
  }
  setDefaultAudioDevice(id: string): void {
    this.calls.push(["setDefaultAudioDevice", id]);
  }
  moveAudioStream(id: string, device: string): void {
    this.calls.push(["moveAudioStream", id, device]);
  }
  setAudioPort(id: string, port: string): void {
    this.calls.push(["setAudioPort", id, port]);
  }
  setAudioProfile(card: string, profile: string): void {
    this.calls.push(["setAudioProfile", card, profile]);
  }
  watchAudioLevels(ids: readonly string[]): void {
    this.calls.push(["watchAudioLevels", [...ids]]);
  }
  themeCaptured(theme: Theme): void {
    this.calls.push(["themeCaptured", theme]);
  }
  grabShortcut(shortcut: DomicileShortcut): void {
    this.calls.push(["grabShortcut", shortcut]);
  }
  activateExtension(id: string): void {
    this.calls.push(["activateExtension", id]);
  }
  openBrowserWindow(url: string): void {
    this.calls.push(["openBrowserWindow", url]);
  }
  closeBrowserWindow(id: string): void {
    this.calls.push(["closeBrowserWindow", id]);
  }
  activateTrayItem(id: string, action: TrayAction): void {
    this.calls.push(["activateTrayItem", id, action]);
  }
  dismissNotifications(ids: readonly number[]): void {
    this.calls.push(["dismissNotifications", ids]);
  }
  invokeNotificationAction(id: number, action: string): void {
    this.calls.push(["invokeNotificationAction", id, action]);
  }
  key(appId: string, keycode: number, pressed: boolean): void {
    this.calls.push(["key", appId, keycode, pressed]);
  }
  pointerMotion(appId: string, x: number, y: number): void {
    this.calls.push(["pointerMotion", appId, x, y]);
  }
  warpPointer(x: number, y: number): void {
    this.calls.push(["warpPointer", x, y]);
  }
  pointerLeave(appId: string): void {
    this.calls.push(["pointerLeave", appId]);
  }
  pointerButton(appId: string, button: number, pressed: boolean): void {
    this.calls.push(["pointerButton", appId, button, pressed]);
  }
  pointerAxis(
    appId: string,
    dx: number,
    dy: number,
    v120X: number,
    v120Y: number,
  ): void {
    this.calls.push(["pointerAxis", appId, dx, dy, v120X, v120Y]);
  }

  /**
   * Describe the desktop: set the attribute, then fire the event, in the
   * engine's order.
   */
  describes(displays: readonly DomicileDisplay[]): void {
    this.displays = displays;
    this.dispatch("displayschanged", new Event("displayschanged"));
  }

  /** Report browser windows: set the attribute, then fire the event. */
  lists(windows: readonly DomicileBrowserWindow[]): void {
    this.browserWindows = windows;
    this.dispatch("browserwindowschanged", new Event("browserwindowschanged"));
  }

  /** Report a brightness: set the attribute, then fire the event. */
  brightens(level: number): void {
    this.brightness = level;
    this.dispatch("brightnesschanged", new Event("brightnesschanged"));
  }

  lastCall(): Call | undefined {
    return this.calls.at(-1);
  }
}

// A browser window. See `domicile-host.ts` for the fields.
const EXAMPLE_WINDOW: DomicileBrowserWindow = {
  height: 0,
  id: "1",
  popupWindow: null,
  title: "Example Domain",
  url: "https://example.com/",
  width: 0,
};

// A display. See `domicile-host.ts` for the fields.
const LEFT: DomicileDisplay = {
  height: 1080,
  modeHeight: 1080,
  modeWidth: 1920,
  name: "left",
  scale: 1,
  transform: "normal",
  width: 1920,
  x: 0,
  y: 0,
};

describe("DomicileClient", () => {
  let host: FakeHost;
  let domicile: DomicileClient;

  beforeEach(() => {
    host = new FakeHost();
    domicile = new DomicileClient(host);
  });

  describe("delivering what the host says", () => {
    it("dispatches a host event to the registered handler", () => {
      const seen: unknown[] = [];
      domicile.on("app_appeared", (message) => {
        seen.push(message);
      });
      host.dispatch(
        "appappeared",
        appEvent("appappeared", {
          appId: "term",
          hasSize: true,
          height: 480,
          title: "Terminal",
          width: 640,
        }),
      );

      expect(seen).toStrictEqual([
        { app_id: "term", size: [640, 480], title: "Terminal" },
      ]);
    });

    it("holds an event that arrives before its handler registers", () => {
      // The client listens from its constructor. A React shell registers
      // handlers after the compositor's first messages, and an unheard DOM
      // event is lost.
      host.dispatch(
        "appappeared",
        appEvent("appappeared", { appId: "term", title: "Terminal" }),
      );
      host.dispatch(
        "appappeared",
        appEvent("appappeared", { appId: "editor", title: "Editor" }),
      );

      const seen: string[] = [];
      domicile.on("app_appeared", (message) => {
        seen.push(message.app_id);
      });

      expect(seen).toStrictEqual(["term", "editor"]);
    });

    it("does not replay a held event to a handler that replaces another", () => {
      // Delivering empties the hold, so a later `on` does not see the same
      // windows again.
      host.dispatch("appappeared", appEvent("appappeared", { appId: "term" }));
      domicile.on("app_appeared", () => {
        // Takes the held message.
      });

      const seen: string[] = [];
      domicile.on("app_appeared", (message) => {
        seen.push(message.app_id);
      });

      expect(seen).toStrictEqual([]);
    });

    it("holds only the type that has no handler", () => {
      // Held per type: a page with only an `app_appeared` handler must not get
      // `app_closed`.
      const seen: string[] = [];
      host.dispatch("appclosed", appEvent("appclosed", { appId: "term" }));
      host.dispatch("appappeared", appEvent("appappeared", { appId: "term" }));

      domicile.on("app_appeared", (message) => {
        seen.push(`appeared:${message.app_id}`);
      });
      expect(seen).toStrictEqual(["appeared:term"]);

      domicile.on("app_closed", (message) => {
        seen.push(`closed:${message.app_id}`);
      });
      expect(seen).toStrictEqual(["appeared:term", "closed:term"]);
    });

    it("delivers the charge nobody asked for", () => {
      // Pushed, not requested, and held like the rest.
      const seen: unknown[] = [];
      domicile.on("battery", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "battery",
        Object.assign(new Event("battery"), {
          arrival: 0,
          charge: 0.42,
          charging: true,
        }),
      );

      expect(seen).toStrictEqual([{ charge: 0.42, charging: true }]);
    });

    it("delivers the brightness off the attribute the bare event names", () => {
      const seen: unknown[] = [];
      domicile.on("brightness", (message) => {
        seen.push(message);
      });

      host.brightens(0.42);

      expect(seen).toStrictEqual([{ level: 0.42 }]);
    });

    it("delivers the clipboard's history nobody asked for", () => {
      // Each message is the whole history, since a copy can reorder it.
      const seen: unknown[] = [];
      domicile.on("clipboard", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "clipboard",
        Object.assign(new Event("clipboard"), {
          arrival: 0,
          entries: [{ id: 3, preview: "ssh-rsa AAAA" }],
        }),
      );

      expect(seen).toStrictEqual([
        { entries: [{ id: 3, preview: "ssh-rsa AAAA" }] },
      ]);
    });

    it("delivers the system tray nobody asked for", () => {
      const seen: unknown[] = [];
      domicile.on("tray", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "tray",
        Object.assign(new Event("tray"), {
          arrival: 0,
          items: [{ icon: "", id: ":1.9/StatusNotifierItem", title: "Sync" }],
        }),
      );

      expect(seen).toStrictEqual([
        {
          items: [
            { icon: undefined, id: ":1.9/StatusNotifierItem", title: "Sync" },
          ],
        },
      ]);
    });

    it("delivers the notifications nobody asked for", () => {
      const seen: unknown[] = [];
      domicile.on("notifications", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "notifications",
        Object.assign(new Event("notifications"), {
          arrival: 0,
          items: [
            {
              actions: [],
              appName: "",
              body: "",
              clickable: false,
              icon: "",
              id: 8,
              summary: "Battery low",
              time: 1,
              timeoutMs: 0,
              urgency: "critical",
            },
          ],
        }),
      );

      expect(seen).toStrictEqual([
        {
          items: [
            {
              actions: [],
              appName: "",
              body: "",
              clickable: false,
              icon: undefined,
              id: 8,
              summary: "Battery low",
              time: 1,
              timeoutMs: 0,
              urgency: "critical",
            },
          ],
        },
      ]);
    });

    it("delivers the extensions in the tray, parsed", () => {
      const seen: unknown[] = [];
      domicile.on("extensions", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "extensions",
        Object.assign(new Event("extensions"), {
          extensions: [
            {
              badgeColor: "#00000000",
              badgeText: "",
              enabled: true,
              icon: "data:image/png;base64,iVBORw0KGgo=",
              id: "abcdefghijklmnopabcdefghijklmnop",
              name: "A tray guard",
              popup: null,
              title: "A tray guard",
            },
          ],
        }),
      );

      expect(seen).toStrictEqual([
        {
          extensions: [
            {
              badgeColor: "#00000000",
              badgeText: "",
              enabled: true,
              icon: "data:image/png;base64,iVBORw0KGgo=",
              id: "abcdefghijklmnopabcdefghijklmnop",
              name: "A tray guard",
              popup: undefined,
              title: "A tray guard",
            },
          ],
        },
      ]);
    });

    it("delivers the theme the desktop is drawn in", () => {
      // `setTheme` is answered with this message, so all pages change together.
      const seen: unknown[] = [];
      domicile.on("theme", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "theme",
        Object.assign(new Event("theme"), {
          arrival: 0,
          theme: "light" as const,
        }),
      );

      expect(seen).toStrictEqual([{ theme: "light" }]);
    });

    it("delivers the theme the desk's windows are drawn in", () => {
      // Sent once the windows have switched theme.
      const seen: unknown[] = [];
      domicile.on("windows_theme", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "windowstheme",
        Object.assign(new Event("windowstheme"), {
          arrival: 0,
          theme: "light" as const,
        }),
      );

      expect(seen).toStrictEqual([{ theme: "light" }]);
    });

    it("delivers whether anybody is at the desk", () => {
      // Held, because the idle state on connect arrives during React's first
      // render.
      const seen: unknown[] = [];
      domicile.on("idle", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "idle",
        Object.assign(new Event("idle"), { arrival: 0, idle: true }),
      );

      expect(seen).toStrictEqual([{ idle: true }]);
    });

    it("delivers whether the desk is locked", () => {
      // Held, because a page reloaded over a locked session learns it on
      // connect, during React's first render.
      const seen: unknown[] = [];
      domicile.on("locked", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "locked",
        Object.assign(new Event("locked"), { arrival: 0, locked: true }),
      );

      expect(seen).toStrictEqual([{ locked: true }]);
    });

    it("delivers the keyboard, held until the shell asks", () => {
      // Sent on connect, before a shell binds its keys, so it must be held.
      host.dispatch(
        "shellconfig",
        Object.assign(new Event("shellconfig"), {
          arrival: 0,
          config: JSON.stringify({
            keys: {},
            type: "shell_config",
          }),
        }),
      );

      const seen: unknown[] = [];
      domicile.on("shell_config", (message) => {
        seen.push(message);
      });

      expect(seen).toStrictEqual([{ keys: new Map() }]);
    });

    it("delivers the desk's sound", () => {
      const seen: unknown[] = [];
      domicile.on("audio", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "audio",
        Object.assign(new Event("audio"), {
          arrival: 0,
          cards: [
            {
              description: "Built-in Audio",
              id: "alsa_card.pci",
              profile: "",
              profiles: [{ available: true, description: "Off", name: "off" }],
            },
          ],
          inputs: [],
          outputs: [
            {
              description: "Speakers",
              id: "output:speakers",
              isDefault: true,
              monitor: false,
              muted: false,
              port: "",
              ports: [],
              volume: 0.5,
            },
          ],
          playback: [
            {
              application: "Firefox",
              device: "",
              id: "playback:42",
              muted: true,
              title: "",
              volume: 1,
            },
          ],
          recording: [],
        }),
      );

      // The engine's empty strings become `undefined`.
      expect(seen).toStrictEqual([
        {
          cards: [
            {
              description: "Built-in Audio",
              id: "alsa_card.pci",
              profile: undefined,
              profiles: [{ available: true, description: "Off", name: "off" }],
            },
          ],
          inputs: [],
          outputs: [
            {
              default: true,
              description: "Speakers",
              id: "output:speakers",
              monitor: false,
              muted: false,
              port: undefined,
              ports: [],
              volume: 0.5,
            },
          ],
          playback: [
            {
              application: "Firefox",
              device: undefined,
              id: "playback:42",
              muted: true,
              title: undefined,
              volume: 1,
            },
          ],
          recording: [],
        },
      ]);
    });

    it("delivers the meters' levels", () => {
      const seen: unknown[] = [];
      domicile.on("audio_levels", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "audiolevels",
        Object.assign(new Event("audiolevels"), {
          arrival: 0,
          levels: [{ id: "input:mic", peak: 0.25 }],
        }),
      );

      expect(seen).toStrictEqual([{ levels: new Map([["input:mic", 0.25]]) }]);
    });

    it("delivers the browser windows", () => {
      // `domicile open-url`, `target="_blank"` and the shell's own UI all
      // arrive as the full list. Held, so a reloaded shell gets the previous
      // shell's windows before its first render.
      const seen: unknown[] = [];
      domicile.on("browser_windows", (message) => {
        seen.push(message);
      });

      host.lists([EXAMPLE_WINDOW]);

      expect(seen).toStrictEqual([{ windows: [EXAMPLE_WINDOW] }]);
    });

    it("delivers the smallest and largest a window will be", () => {
      const limits: unknown[] = [];
      domicile.on("app_min_size", (message) => {
        limits.push(["min", message]);
      });
      domicile.on("app_max_size", (message) => {
        limits.push(["max", message]);
      });

      host.dispatch(
        "appminsize",
        appEvent("appminsize", {
          appId: "vault",
          hasSize: true,
          height: 500,
          width: 680,
        }),
      );
      host.dispatch(
        "appmaxsize",
        appEvent("appmaxsize", {
          appId: "vault",
          hasSize: true,
          height: 800,
          width: 1000,
        }),
      );

      expect(limits).toStrictEqual([
        ["min", { app_id: "vault", size: [680, 500] }],
        ["max", { app_id: "vault", size: [1000, 800] }],
      ]);
    });

    it("delivers a popup, and knows which window it is over", () => {
      const placed: unknown[] = [];
      domicile.on("popup_placed", (message) => {
        placed.push(message);
      });

      host.dispatch(
        "popupplaced",
        appEvent("popupplaced", {
          appId: "menu",
          grab: true,
          hasSize: true,
          height: 240,
          parentAppId: "term",
          width: 180,
          x: 12,
          y: 30,
        }),
      );
      // A submenu of the menu, so of the same window.
      host.dispatch(
        "popupplaced",
        appEvent("popupplaced", {
          appId: "submenu",
          hasSize: true,
          height: 100,
          parentAppId: "menu",
          width: 100,
          x: 180,
        }),
      );

      expect(placed).toHaveLength(2);
      expect(placed[0]).toStrictEqual({
        app_id: "menu",
        grab: true,
        parent: "term",
        position: [12, 30],
        size: [180, 240],
      });
      expect(domicile.windowOf("submenu")).toBe("term");
      expect(domicile.windowOf("term")).toBe("term");
      // Pointer mapping uses the popup's buffer size.
      expect(domicile.surfaceSizeOf("menu")).toStrictEqual([180, 240]);

      host.dispatch("appclosed", appEvent("appclosed", { appId: "menu" }));
      expect(domicile.windowOf("menu")).toBe("menu");
    });

    it("delivers a client's request for the keyboard without moving it", () => {
      const asked: unknown[] = [];
      domicile.on("focus_requested", (message) => {
        asked.push(message);
      });

      host.dispatch(
        "focusrequested",
        appEvent("focusrequested", { appId: "term" }),
      );

      expect(asked).toStrictEqual([{ app_id: "term" }]);
      // The client does not focus; the shell answers with `focusApp`.
      expect(host.lastCall()).toBeUndefined();
    });

    // Keys go where the compositor says focus is, not only where the page last
    // asked: the compositor also moves focus on its own.
    it("routes the page's keys to whoever the compositor says has them", () => {
      focusApp(domicile, "term");

      host.dispatch("focuschanged", appEvent("focuschanged", { appId: "" }));
      expect(focusedApp()).toBeUndefined();

      host.dispatch(
        "focuschanged",
        appEvent("focuschanged", { appId: "editor" }),
      );
      expect(focusedApp()).toBe("editor");
    });
  });

  describe("what a client has said about its own window", () => {
    // Surface sizes are recorded for the SDK's pointer mapping and read on
    // demand, so they take no handler slot.
    it("remembers the size a client drew at", () => {
      host.dispatch(
        "appresized",
        appEvent("appresized", {
          appId: "term",
          hasSize: true,
          height: 480,
          width: 640,
        }),
      );

      expect(domicile.surfaceSizeOf("term")).toStrictEqual([640, 480]);
    });

    it("knows nothing about a client that has not drawn", () => {
      // A toplevel maps before it draws, so there is no size yet.
      host.dispatch(
        "appappeared",
        appEvent("appappeared", { appId: "term", title: "Terminal" }),
      );

      expect(domicile.surfaceSizeOf("term")).toBeUndefined();
    });

    it("remembers the size a replayed window had already drawn at", () => {
      // On reconnect, `app_appeared` carries the size and no `app_resized`
      // follows for an idle client.
      host.dispatch(
        "appappeared",
        appEvent("appappeared", {
          appId: "term",
          hasSize: true,
          height: 480,
          title: "Terminal",
          width: 640,
        }),
      );

      expect(domicile.surfaceSizeOf("term")).toStrictEqual([640, 480]);
    });

    it("forgets a client that has gone", () => {
      host.dispatch(
        "appresized",
        appEvent("appresized", {
          appId: "term",
          hasSize: true,
          height: 480,
          width: 640,
        }),
      );
      host.dispatch("appclosed", appEvent("appclosed", { appId: "term" }));

      expect(domicile.surfaceSizeOf("term")).toBeUndefined();
    });
  });

  describe("asking the host for something", () => {
    it("calls the host's methods rather than building a message", () => {
      domicile.focusApp("term");
      expect(host.lastCall()).toStrictEqual(["focusApp", "term"]);

      domicile.focusChrome();
      expect(host.lastCall()).toStrictEqual(["focusChrome"]);

      domicile.closeApp("term");
      expect(host.lastCall()).toStrictEqual(["closeApp", "term"]);

      domicile.spawn(["kitty"]);
      expect(host.lastCall()).toStrictEqual(["spawn", ["kitty"]]);

      domicile.copyClipboardEntry(3);
      expect(host.lastCall()).toStrictEqual(["copyClipboardEntry", 3]);

      domicile.openBrowserWindow("https://example.com/");
      expect(host.lastCall()).toStrictEqual([
        "openBrowserWindow",
        "https://example.com/",
      ]);

      domicile.closeBrowserWindow("1");
      expect(host.lastCall()).toStrictEqual(["closeBrowserWindow", "1"]);

      domicile.activateExtension("abcdefghijklmnopabcdefghijklmnop");
      expect(host.lastCall()).toStrictEqual([
        "activateExtension",
        "abcdefghijklmnopabcdefghijklmnop",
      ]);

      domicile.activateTrayItem(":1.9/StatusNotifierItem", "context");
      expect(host.lastCall()).toStrictEqual([
        "activateTrayItem",
        ":1.9/StatusNotifierItem",
        "context",
      ]);

      domicile.dismissNotifications([7, 8]);
      expect(host.lastCall()).toStrictEqual(["dismissNotifications", [7, 8]]);

      domicile.invokeNotificationAction(7, "reply");
      expect(host.lastCall()).toStrictEqual([
        "invokeNotificationAction",
        7,
        "reply",
      ]);

      // Only forwarded; the page renders from the `theme` message.
      domicile.setTheme("light");
      expect(host.lastCall()).toStrictEqual(["setTheme", "light"]);
    });

    it("offers a passphrase at a locked desk and applies nothing", () => {
      // Only forwarded. The page must clear its lock screen on the `locked`
      // message, never on its own input.
      domicile.unlock("open sesame");
      expect(host.lastCall()).toStrictEqual(["unlock", "open sesame"]);

      // Answered by a `locked` message.
      domicile.lock();
      expect(host.lastCall()).toStrictEqual(["lock"]);

      // Answered by a `brightness` message.
      domicile.setBrightness(0.3);
      expect(host.lastCall()).toStrictEqual(["setBrightness", 0.3]);

      // Each answered by the next `audio` message.
      domicile.setAudioVolume("output:s", 0.4);
      expect(host.lastCall()).toStrictEqual([
        "setAudioVolume",
        "output:s",
        0.4,
      ]);
      domicile.setAudioMuted("input:m", true);
      expect(host.lastCall()).toStrictEqual(["setAudioMuted", "input:m", true]);
      domicile.setDefaultAudioDevice("output:s");
      expect(host.lastCall()).toStrictEqual([
        "setDefaultAudioDevice",
        "output:s",
      ]);
      domicile.moveAudioStream("playback:4", "output:s");
      expect(host.lastCall()).toStrictEqual([
        "moveAudioStream",
        "playback:4",
        "output:s",
      ]);
      domicile.setAudioPort("output:s", "headphones");
      expect(host.lastCall()).toStrictEqual([
        "setAudioPort",
        "output:s",
        "headphones",
      ]);
      domicile.setAudioProfile("card", "off");
      expect(host.lastCall()).toStrictEqual(["setAudioProfile", "card", "off"]);
      domicile.watchAudioLevels(["input:mic"]);
      expect(host.lastCall()).toStrictEqual([
        "watchAudioLevels",
        ["input:mic"],
      ]);

      domicile.themeCaptured("light");
      expect(host.lastCall()).toStrictEqual(["themeCaptured", "light"]);

      domicile.grabShortcut({ altKey: true, keycode: 28 });
      expect(host.lastCall()).toStrictEqual([
        "grabShortcut",
        { altKey: true, keycode: 28 },
      ]);

      domicile.pointerMotion("term", 5, 6);
      expect(host.lastCall()).toStrictEqual(["pointerMotion", "term", 5, 6]);

      domicile.pointerLeave("term");
      expect(host.lastCall()).toStrictEqual(["pointerLeave", "term"]);

      domicile.pointerButton("term", BTN_LEFT, true);
      expect(host.lastCall()).toStrictEqual([
        "pointerButton",
        "term",
        BTN_LEFT,
        true,
      ]);

      domicile.pointerAxis("term", { dx: 0, dy: 100, v120X: 0, v120Y: 120 });
      expect(host.lastCall()).toStrictEqual([
        "pointerAxis",
        "term",
        0,
        100,
        0,
        120,
      ]);

      domicile.key("term", 30, true);
      expect(host.lastCall()).toStrictEqual(["key", "term", 30, true]);
    });

    it("spreads a pointer's destination into the two doubles the host takes", () => {
      // WebIDL has no tuple, so the point is two arguments. Coordinates may be
      // fractional.
      domicile.warpPointer([960.5, 540.25]);
      expect(host.lastCall()).toStrictEqual(["warpPointer", 960.5, 540.25]);
    });

    it("claims a grabbed chord for the page as well as the browser process", () => {
      // The page also records the grab so `keyboard-input.ts` does not forward
      // the chord to a focused Wayland window.
      domicile.grabShortcut({ altKey: true, keycode: 15, shiftKey: true });

      expect(
        isClaimed({
          altKey: true,
          ctrlKey: false,
          keycode: 15,
          metaKey: false,
          shiftKey: true,
        }),
      ).toBe(true);
    });
  });

  describe("searching the home", () => {
    /** Dispatch the compositor's answer to `query`. */
    const answer = (query: string, files: readonly string[]) => {
      host.dispatch(
        "files",
        Object.assign(new Event("files"), {
          arrival: 0,
          files,
          indexing: false,
          matched: files.length,
          query,
        }),
      );
    };

    it("asks the host, and settles with what that query found", async () => {
      const found = domicile.searchFiles("notes");
      expect(host.lastCall()).toStrictEqual(["searchFiles", "notes"]);

      answer("notes", ["Notes/", "Notes/today.org"]);

      expect(await found).toStrictEqual({
        files: ["Notes/", "Notes/today.org"],
        indexing: false,
        matched: 2,
        query: "notes",
      });
    });

    it("settles each search with its own answer, whichever comes back first", async () => {
      // Searches overlap while typing; the answer to `n` must not settle `no`.
      const shorter = domicile.searchFiles("n");
      const longer = domicile.searchFiles("no");

      answer("no", ["Notes/"]);
      answer("n", ["Notes/", "src/nix/"]);

      expect((await shorter).files).toStrictEqual(["Notes/", "src/nix/"]);
      expect((await longer).files).toStrictEqual(["Notes/"]);
    });
  });

  describe("previewing a file", () => {
    /** Dispatch a text preview of `path`. */
    const answer = (path: string, text: string) => {
      host.dispatch(
        "filepreview",
        Object.assign(new Event("filepreview"), {
          album: "",
          arrival: 0,
          artist: "",
          cover: "",
          duration: 0,
          entries: [],
          kind: "text",
          path,
          text,
          title: "",
        }),
      );
    };

    it("asks the host, and settles each preview with its own path's answer", async () => {
      // Previews overlap while the highlight moves.
      const first = domicile.previewFile("a.txt");
      expect(host.lastCall()).toStrictEqual(["previewFile", "a.txt"]);
      const second = domicile.previewFile("b.txt");

      answer("b.txt", "bee");
      answer("a.txt", "ay");

      expect(await first).toStrictEqual({
        path: "a.txt",
        preview: FilePreview.Text("ay"),
      });
      expect((await second).preview).toStrictEqual(FilePreview.Text("bee"));
    });
  });

  describe("searching for an application", () => {
    const editor = {
      command: ["editor"],
      comment: "Edit text",
      icon: "",
      id: "editor.desktop",
      name: "Editor",
      preview: "",
    };

    /** Dispatch the compositor's answer to `query`. */
    const answer = (query: string, apps: readonly (typeof editor)[]) => {
      host.dispatch(
        "apps",
        Object.assign(new Event("apps"), {
          apps,
          arrival: 0,
          bookmarks: [],
          query,
        }),
      );
    };

    it("asks the host, and settles each search with its own query's answer", async () => {
      const shorter = domicile.searchApps("e");
      expect(host.lastCall()).toStrictEqual(["searchApps", "e"]);
      const longer = domicile.searchApps("ed");

      answer("ed", [editor]);
      answer("e", []);

      expect(await longer).toStrictEqual({
        apps: [{ ...editor, icon: undefined, preview: undefined }],
        bookmarks: [],
        query: "ed",
      });
      expect((await shorter).apps).toStrictEqual([]);
    });
  });

  describe("letting a handler go", () => {
    it("stops delivering to a handler that has been taken off", () => {
      // Lets an unmounting component stop its handler being called.
      const seen: unknown[] = [];
      const handler = (message: { app_id: string }) => {
        seen.push(message.app_id);
      };
      domicile.on("app_closed", handler);
      domicile.off("app_closed", handler);
      host.dispatch("appclosed", appEvent("appclosed", { appId: "gone" }));

      expect(seen).toStrictEqual([]);
    });

    it("drops what arrives after it rather than piling it up", () => {
      // After `off`, nothing is held for the type; nothing would drain it.
      const handler = () => undefined;
      domicile.on("app_closed", handler);
      domicile.off("app_closed", handler);
      host.dispatch("appclosed", appEvent("appclosed", { appId: "gone" }));

      const seen: unknown[] = [];
      domicile.on("app_closed", (message) => {
        seen.push(message.app_id);
      });

      expect(seen).toStrictEqual([]);
    });

    it("leaves a handler that replaced it alone", () => {
      // `on` is one slot, so removing an already replaced handler must not
      // remove the live one.
      const seen: unknown[] = [];
      const first = () => seen.push("first");
      domicile.on("app_closed", first);
      domicile.on("app_closed", () => seen.push("second"));
      domicile.off("app_closed", first);
      host.dispatch("appclosed", appEvent("appclosed", { appId: "gone" }));

      expect(seen).toStrictEqual(["second"]);
    });
  });

  describe("the browser windows the host listed", () => {
    it("is nothing until the host says", () => {
      // Distinct from an empty list, as for `displays`. Otherwise a shell
      // would flash empty after every load-shell, before the list arrives.
      expect(domicile.browserWindows).toBeUndefined();
    });

    it("reads through to the host", () => {
      host.lists([EXAMPLE_WINDOW]);

      expect(domicile.browserWindows).toStrictEqual([EXAMPLE_WINDOW]);
    });
  });

  describe("the desktop the host described", () => {
    it("is nothing until the host says", () => {
      // Distinct from `[]`, a desktop with no displays.
      expect(domicile.displays).toBeUndefined();
    });

    it("is a desktop of no screens when that is what it was told", () => {
      // `[]` is a real answer, distinct from `undefined`.
      host.describes([]);

      expect(domicile.displays).toStrictEqual([]);
      expect(domicile.displays).not.toBeUndefined();
    });

    it("reads through to the host, so everything that asks gets it", () => {
      // Read from the host, so late readers get the same answer.
      host.describes([LEFT]);

      expect(domicile.displays).toStrictEqual([LEFT]);
      expect(domicile.displays).toStrictEqual([LEFT]);
    });

    it("is the desktop the host describes now", () => {
      // Without configured displays, every window resize re-describes the
      // desktop.
      const RIGHT: DomicileDisplay = {
        height: 1440,
        modeHeight: 2880,
        modeWidth: 5120,
        name: "right",
        scale: 2,
        transform: "normal",
        width: 2560,
        x: 1920,
        y: 0,
      };
      host.describes([LEFT]);
      host.describes([LEFT, RIGHT]);

      expect(domicile.displays).toStrictEqual([LEFT, RIGHT]);
    });

    it("reaches a handler that registers after the description", () => {
      // The client reads the attribute and delivers it, and holds it for a late
      // handler.
      host.describes([LEFT]);

      const seen: unknown[] = [];
      domicile.on("displays", (message) => {
        seen.push(message.displays);
      });

      expect(seen).toStrictEqual([[LEFT]]);
    });

    it("is already the new desktop when the handler runs", () => {
      // The engine sets the attribute before dispatching.
      let seen: readonly DomicileDisplay[] | undefined;
      domicile.on("displays", () => {
        seen = domicile.displays;
      });
      host.describes([LEFT]);

      expect(seen).toStrictEqual([LEFT]);
    });
  });
});
