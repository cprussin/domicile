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

type Call = readonly [kind: string, ...args: unknown[]];

/** The fields a `DomicileAppEvent` carries, all of them optional to a test. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent`, with the fields that event does not carry left as the
 * empty string the engine fills them with.
 *
 * `Object.assign` onto an `Event` rather than a subclass per event type: what
 * the client reads is the fields, and five classes saying that would be a test
 * of the test.
 */
const appEvent = (type: string, fields: AppEventFields): DomicileAppEvent =>
  Object.assign(new Event(type), {
    appId: "",
    cursor: "",
    hasSize: false,
    height: 0,
    title: "",
    width: 0,
    ...fields,
  });

/**
 * A stand-in for `navigator.domicile`: it records what the page asks of it, and
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
  focusApp(appId: string): void {
    this.calls.push(["focusApp", appId]);
  }
  focusChrome(): void {
    this.calls.push(["focusChrome"]);
  }
  closeApp(appId: string): void {
    this.calls.push(["closeApp", appId]);
  }
  resizeApp(appId: string, width: number, height: number): void {
    this.calls.push(["resizeApp", appId, width, height]);
  }
  setDesktopSize(width: number, height: number): void {
    this.calls.push(["setDesktopSize", width, height]);
  }
  setDevicePixelRatio(ratio: number): void {
    this.calls.push(["setDevicePixelRatio", ratio]);
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

const LEFT: DomicileDisplay = {
  height: 1080,
  name: "left",
  scale: 1,
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

      domicile.setDevicePixelRatio(2);
      expect(host.lastCall()).toStrictEqual(["setDevicePixelRatio", 2]);

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

    it("spreads a size into the two doubles the host takes", () => {
      // A box is one value to a shell and two arguments to WebIDL, which has
      // no tuple. Unpacked here rather than at every call site — and the
      // fractions survive, because a CSS pixel is fractional and the whole
      // path is `double`.
      domicile.resizeApp("term", [800.5, 600.25]);
      expect(host.lastCall()).toStrictEqual([
        "resizeApp",
        "term",
        800.5,
        600.25,
      ]);

      domicile.setDesktopSize([1280.5, 800]);
      expect(host.lastCall()).toStrictEqual(["setDesktopSize", 1280.5, 800]);
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
      // the first. A teardown that ran afterwards and removed whatever it
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
        name: "right",
        scale: 2,
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
