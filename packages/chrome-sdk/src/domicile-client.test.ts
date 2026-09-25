import { beforeEach, describe, expect, it } from "bun:test";

import { DomicileClient } from "./domicile-client";
import type {
  DomicileAppEvent,
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
  DomicileShortcut,
} from "./domicile-host";
import { BTN_LEFT } from "./input";
import { isClaimed } from "./shortcut-claims";
import type { Theme } from "./theme";

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
    hasSize: false,
    height: 0,
    title: "",
    width: 0,
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
  searchFiles(query: string): void {
    this.calls.push(["searchFiles", query]);
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
  setDesktopSize(width: number, height: number): void {
    this.calls.push(["setDesktopSize", width, height]);
  }
  setDevicePixelRatio(ratio: number): void {
    this.calls.push(["setDevicePixelRatio", ratio]);
  }
  setTheme(theme: Theme): void {
    this.calls.push(["setTheme", theme]);
  }
  grabShortcut(shortcut: DomicileShortcut): void {
    this.calls.push(["grabShortcut", shortcut]);
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

  lastCall(): Call | undefined {
    return this.calls.at(-1);
  }
}

// A monitor of a desktop the page's window is the whole of, which is what
// every test in this file is about. `domicile-host.ts` documents what the
// other three mean; a screen that IS its window is
// `shell-manganese/src/screens/host-displays.test.ts`.
const LEFT: DomicileDisplay = {
  fillsTheWindow: false,
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

      domicile.setDevicePixelRatio(2);
      expect(host.lastCall()).toStrictEqual(["setDevicePixelRatio", 2]);

      // Passed on and nothing else: what a page draws comes back as a `theme`
      // message, because every chrome on the desk is told.
      domicile.setTheme("light");
      expect(host.lastCall()).toStrictEqual(["setTheme", "light"]);

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
      // The same unpacking `setDesktopSize` does below, for the same reason: a
      // place on the desktop is one value to a shell and two arguments to
      // WebIDL, and a CSS pixel is fractional the whole way across.
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

    it("spreads a size into the two doubles the host takes", () => {
      // A box is one value to a shell and two arguments to WebIDL, which has
      // no tuple. Unpacked here rather than at every call site — and the
      // fractions survive, because a CSS pixel is fractional and the whole
      // path is `double`.
      domicile.setDesktopSize([1280.5, 800]);
      expect(host.lastCall()).toStrictEqual(["setDesktopSize", 1280.5, 800]);
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
        fillsTheWindow: false,
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
