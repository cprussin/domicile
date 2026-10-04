import { beforeEach, describe, expect, it } from "bun:test";

import { DomicileClient } from "./domicile-client";
import type {
  DomicileAppEvent,
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

/** The fields a `DomicileAppEvent` carries, all of them optional to a test. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent`, with the fields that event does not carry left as the
 * empty string the engine fills them with, and a zero `arrival` — nothing the
 * client does with one of these is about the hop.
 *
 * `Object.assign` onto an `Event` rather than a subclass per event type: what
 * the client reads is the fields, and five classes saying that would be a test
 * of the test.
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
 * A stand-in for `window.domicile`: it records what the page asks of it, and
 * it fires an event only at whatever registered for that event through
 * `addEventListener`.
 *
 * **That last part is the point of the double.** What is under test is that
 * `DomicileClient` registers listeners *of its own*, in its constructor, rather
 * than leaving the page to do it — so `dispatch` below reaches nothing unless
 * it did. A double that called the client's handlers directly would be green
 * with those listeners never registered at all, which is the one failure that
 * loses a live client's window.
 *
 * Its own registry rather than an `EventTarget`, for two reasons. A real one
 * types `addEventListener`'s callback as `EventListener | EventListenerObject |
 * null`, which no typed listener is assignable to in either direction, so a
 * class extending it cannot `implements DomicileHost` without a cast. And a
 * real one swallows a listener's throw — the DOM reports it to the page's error
 * handler rather than raising it to whoever dispatched — which is exactly why
 * the translation lives in `host-message.ts` and is tested there.
 */
class FakeHost implements DomicileHost {
  readonly calls: Call[] = [];

  /** Empty until the compositor has described the desktop, as the fork's is. */
  displays: readonly DomicileDisplay[] | null = null;

  /** Null until the compositor has said a brightness, as the fork's is. */
  brightness: number | null = null;
  readonly windows: readonly DomicileWindow[] = [];
  readonly focusedWindow: string | null = null;
  readonly altKey = null;
  readonly audioCards = null;
  readonly audioInputs = null;
  readonly audioOutputs = null;
  readonly audioPlayback = null;
  readonly audioRecording = null;
  readonly batteryCharge = null;
  readonly batteryCharging = null;
  readonly clipboard = null;
  readonly ctrlKey = null;
  readonly extensions = null;
  readonly idle = null;
  readonly locked = null;
  readonly metaKey = null;
  readonly notifications = null;
  readonly shiftKey = null;
  readonly theme = null;
  readonly tray = null;
  readonly windowsTheme = null;

  readonly #listeners = new Map<string, (event: never) => void>();

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void {
    this.#listeners.set(type, listener);
  }

  /** The compositor saying something, to whoever asked to hear that. */
  dispatch<T extends keyof DomicileHostEventMap>(
    type: T,
    event: DomicileHostEventMap[T],
  ): void {
    this.#listeners.get(type)?.(event as never);
  }

  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
  }
  // Each ask's own promise rejects, as the engine's does for every ask a newer
  // one supersedes: the client settles from the answering event, and a
  // rejection it ignored would surface as an unhandled one.
  searchFiles(query: string): Promise<never> {
    this.calls.push(["searchFiles", query]);
    return Promise.reject(new DOMException("superseded", "AbortError"));
  }
  previewFile(path: string): Promise<never> {
    this.calls.push(["previewFile", path]);
    return Promise.reject(new DOMException("superseded", "AbortError"));
  }
  searchApps(query: string): Promise<never> {
    this.calls.push(["searchApps", query]);
    return Promise.reject(new DOMException("superseded", "AbortError"));
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
   * The compositor describing the desktop: the attribute is written and *then*
   * the bare event fires, which is the engine's order and the reason a handler
   * can read the accessor and see this desktop.
   */
  describes(displays: readonly DomicileDisplay[]): void {
    this.displays = displays;
    this.dispatch("displayschanged", new Event("displayschanged"));
  }

  /** The backlight moving: the attribute, then the bare event. */
  brightens(level: number): void {
    this.brightness = level;
    this.dispatch("brightnesschanged", new Event("brightnesschanged"));
  }

  lastCall(): Call | undefined {
    return this.calls.at(-1);
  }
}

// A monitor of the desk. `domicile-host.ts` documents what each field means.
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
      // THE REASON THE BRIDGE LISTENS ON ITS OWN ACCOUNT, IN ITS CONSTRUCTOR.
      // A DOM event dispatched with no listener registered is gone — an
      // EventTarget has no mailbox — and a React shell registers its handlers
      // in its first effect flush, tens of milliseconds after the compositor
      // has started talking. Always after, never before: rendering only
      // *schedules* the effect. What lands in that window is a live, drawing
      // client, and there is no second announcement for it.
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
      // The flush empties the hold. Without that, every later `on` for the
      // same type would mount the same windows again.
      host.dispatch("appappeared", appEvent("appappeared", { appId: "term" }));
      domicile.on("app_appeared", () => {
        // The first handler takes the held message; this is about the second.
      });

      const seen: string[] = [];
      domicile.on("app_appeared", (message) => {
        seen.push(message.app_id);
      });

      expect(seen).toStrictEqual([]);
    });

    it("holds only the type that has no handler", () => {
      // One hold per type, not one queue for everything: a page that registers
      // `app_appeared` must not be handed the `app_closed` it has no handler
      // for yet.
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
      // The other shape of message on this channel: pushed rather than
      // answered, because a battery changes on its own. It goes through the
      // same hold as the rest, which is what a bar that mounted a moment after
      // the page connected needs.
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
      // Pushed like the charge, and like it the whole state every time: a
      // copy re-orders the history as often as it adds to it, so there is no
      // delta a page could apply.
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
      // Pushed like the charge, and the one pushed message this page can
      // cause: `setTheme` is answered with this rather than applied where it
      // was called, so a desk of three pages moves together.
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
      // The other half of `theme`: it arrives once the windows have turned,
      // which a shell holding its wipe waits for.
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
      // Through the same hold as the rest, and that is what this one is for:
      // the message a page gets on connecting is the one that says the desk
      // has been idle since before the page existed, and it lands while React
      // is still on its first render.
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
      // Through the same hold as the rest, and this is the message that hold
      // was built for: a page that reloaded over a locked desk is told so as it
      // connects, which lands while React is still on its first render. A shell
      // that missed it would draw an open desktop over a desk that delivers
      // nothing.
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
      // Sent as the page connects, which is before any shell has bound its
      // keys: a desktop that dropped it would answer no key at all.
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

      // The engine's empty strings are the SDK's `undefined`.
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

    it("delivers an address to open", () => {
      // `domicile open-url`, which is what `BROWSER` runs inside a desktop.
      // Through the hold like the rest: an app can open a link while the
      // shell is still on its first render.
      const seen: unknown[] = [];
      domicile.on("open_url", (message) => {
        seen.push(message);
      });

      host.dispatch(
        "openurl",
        Object.assign(new Event("openurl"), { url: "https://example.com/" }),
      );

      expect(seen).toStrictEqual([{ url: "https://example.com/" }]);
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
      // A submenu, which is over the menu and so over the same window.
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
      // A popup's box is its buffer, which is what the pointer maps through.
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
      // And nothing was asked of the host: a request the shell has not
      // answered yet is a request, and answering it is `focusApp`.
      expect(host.lastCall()).toBeUndefined();
    });

    // THE PAGE FORWARDS KEYS TO WHERE THE COMPOSITOR SAYS THE KEYBOARD IS, and
    // not only to where the page last asked for it. The compositor moves the
    // keyboard on its own — a focused client going away, a press on another
    // monitor's page — and a page that heard only its own requests went on
    // forwarding every key to the client it last named: a launcher's box
    // focused over that window and taking none of the letters typed into it.
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
    // The size a client drew at is recorded as the message goes past, because
    // it is only ever an input to the SDK's own pointer arithmetic: a shell
    // that carried it to an element was a courier for a fact it had no other
    // use for. Read on demand rather than pushed, the way `displays` is, so
    // nothing subscribes and no handler slot is taken from the page.
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
      // A toplevel maps before it draws, so the announcement carries no size —
      // and the pointer over such a window maps against the element's own box
      // rather than against a size invented for it.
      host.dispatch(
        "appappeared",
        appEvent("appappeared", { appId: "term", title: "Terminal" }),
      );

      expect(domicile.surfaceSizeOf("term")).toBeUndefined();
    });

    it("remembers the size a replayed window had already drawn at", () => {
      // The replay a reconnecting chrome is given carries whatever the client
      // has committed since it mapped, and no `app_resized` follows it: that
      // fires on a size that *changed*, so an idle client sends none. Without
      // this the pointer over every window that was already running would be
      // scaled against nothing.
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
      // The size is the client's, so it ends with the client rather than with
      // whatever element happened to be showing it.
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

      // Passed on and nothing else: what a page draws comes back as a `theme`
      // message, because every chrome on the desk is told.
      domicile.setTheme("light");
      expect(host.lastCall()).toStrictEqual(["setTheme", "light"]);
    });

    it("offers a passphrase at a locked desk and applies nothing", () => {
      // NOTHING IS APPLIED HERE, which is the same property `setTheme` above
      // has and for a harder reason: a page that cleared its own lock screen
      // because it believed its own keystrokes would be a lock anybody with the
      // devtools could open. What opens the desk is the compositor agreeing, and
      // what this page hears about it is a `locked` message.
      domicile.unlock("open sesame");
      expect(host.lastCall()).toStrictEqual(["unlock", "open sesame"]);

      // And the other way, which likewise waits for the `locked` message.
      domicile.lock();
      expect(host.lastCall()).toStrictEqual(["lock"]);

      // And the brightness, which comes back as a `brightness` message.
      domicile.setBrightness(0.3);
      expect(host.lastCall()).toStrictEqual(["setBrightness", 0.3]);

      // And the mixer's, each answered with the next `audio` message.
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
      // A place on the desktop is one value to a shell and two arguments to
      // WebIDL, which has no tuple, and a CSS pixel is fractional the whole
      // way across.
      domicile.warpPointer([960.5, 540.25]);
      expect(host.lastCall()).toStrictEqual(["warpPointer", 960.5, 540.25]);
    });

    it("claims a grabbed chord for the page as well as the browser process", () => {
      // The browser process matches a claim for a focused `<webview>`, whose
      // keys never reach this document. A focused Wayland window's do — it is
      // an element in this page — so the page has to know the same claim, or
      // `keyboard-input.ts` forwards the chord to the window the shell just
      // answered it over.
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
    /** The compositor answering `query`, as the engine dispatches it. */
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
      // A launcher asks on every keystroke, so two are in flight whenever
      // somebody types faster than the compositor answers. The answer to `n`
      // is not the answer to `no`.
      const shorter = domicile.searchFiles("n");
      const longer = domicile.searchFiles("no");

      answer("no", ["Notes/"]);
      answer("n", ["Notes/", "src/nix/"]);

      expect((await shorter).files).toStrictEqual(["Notes/", "src/nix/"]);
      expect((await longer).files).toStrictEqual(["Notes/"]);
    });
  });

  describe("previewing a file", () => {
    /** The compositor saying what `path` holds, as text. */
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
      // A launcher asks as the highlight moves, so two are in flight whenever
      // an arrow key is faster than the compositor.
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

    /** The compositor answering `query`, as the engine dispatches it. */
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
      // A page that unmounts the thing that registered has to be able to say
      // so. Without it the handler outlives its tree and is called into
      // whatever is left of it.
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
      // The hold is for the gap before the page has *ever* listened for a
      // type — see `#held`. An `off` says the page listened and stopped, so
      // holding again would accumulate forever with nothing to drain it.
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
      // `on` is a single slot, so the second registration already displaced
      // the first. A teardown that ran afterward and removed whatever it
      // found would silence the live handler on behalf of a dead one. Which
      // caller does that is not this class's business to predict: taking the
      // handler is what makes letting one go safe in any order.
      const seen: unknown[] = [];
      const first = () => seen.push("first");
      domicile.on("app_closed", first);
      domicile.on("app_closed", () => seen.push("second"));
      domicile.off("app_closed", first);
      host.dispatch("appclosed", appEvent("appclosed", { appId: "gone" }));

      expect(seen).toStrictEqual(["second"]);
    });
  });

  describe("the desktop the host described", () => {
    it("is nothing until the host says", () => {
      // Distinct from a desktop of no displays, which is an answer. A shell
      // that could not tell them apart would render its "no screens" case for
      // the moment before the answer arrives.
      expect(domicile.displays).toBeUndefined();
    });

    it("is a desktop of no screens when that is what it was told", () => {
      // The other half of the rule above, and the one that used to be
      // unsayable: the attribute was a FrozenArray that started empty, so
      // "nobody has described a desktop" and "this desktop has none" were the
      // same value and the SDK guessed between them. `null` is the first and
      // `[]` is the second, and a `<Screen>` renders nothing for either — which
      // is right for one and wrong for the other, so a shell needs to know.
      host.describes([]);

      expect(domicile.displays).toStrictEqual([]);
      expect(domicile.displays).not.toBeUndefined();
    });

    it("reads through to the host, so everything that asks gets it", () => {
      // Not retained here any more: the desktop is an attribute on the host,
      // which every reader can reach whenever it likes. A component that
      // mounts long after the description gets the same answer as one that was
      // there for it.
      host.describes([LEFT]);

      expect(domicile.displays).toStrictEqual([LEFT]);
      expect(domicile.displays).toStrictEqual([LEFT]);
    });

    it("is the desktop the host describes now", () => {
      // Latest wins, and reading through is what makes that free: with no
      // displays configured the desktop is Domicile's own window, so every
      // resize and every density change re-describes it.
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
      // `displayschanged` is bare, so a shell that wants to *react* to a
      // change would otherwise have to go and read the attribute itself. The
      // client reads it and delivers it, and the hold covers a handler that
      // was not there when it fired.
      host.describes([LEFT]);

      const seen: unknown[] = [];
      domicile.on("displays", (message) => {
        seen.push(message.displays);
      });

      expect(seen).toStrictEqual([[LEFT]]);
    });

    it("is already the new desktop when the handler runs", () => {
      // The attribute is written before the event is dispatched — the engine's
      // ordering, not this class's — so a handler that reads the accessor sees
      // this desktop rather than the one before it.
      let seen: readonly DomicileDisplay[] | undefined;
      domicile.on("displays", () => {
        seen = domicile.displays;
      });
      host.describes([LEFT]);

      expect(seen).toStrictEqual([LEFT]);
    });
  });
});
