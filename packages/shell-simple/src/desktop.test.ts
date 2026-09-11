import { beforeEach, describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";

import { Desktop } from "./desktop";

// The elements report their size to the domicile client as they mount; nothing
// here reads what they say, so a recorder that answers every call is enough.
const silentDomicile = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
  resizeApp: () => undefined,
} as unknown as DomicileClient;

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
});

/** A desktop whose elements report to a client that keeps who was focused. */
const recordingDesktop = () => {
  const acted: string[] = [];
  const domicile = {
    ...silentDomicile,
    focusApp: (appId: string) => acted.push(`focus:${appId}`),
  } as unknown as DomicileClient;
  registerElements(domicile, {
    measure: stubMeasure,
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window resizes.
    },
  });
  return { acted, desktop: new Desktop(freshRoot()) };
};

const windowFor = (root: HTMLElement, appId: string): HTMLElement => {
  const element = root.querySelector(`${APP_TAG_NAME}[app-id="${appId}"]`);
  if (element instanceof HTMLElement) {
    return element;
  } else {
    throw new Error(`test: the desktop is showing no window for ${appId}`);
  }
};

const freshRoot = (): HTMLElement => {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
};

beforeEach(() => {
  document.body.replaceChildren();
  registerElements(silentDomicile, {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window resizes.
    },
  });
});

describe("Desktop", () => {
  describe("the window list", () => {
    it("mounts a portal for a client the host announced, at the size it asked for", () => {
      const root = freshRoot();
      new Desktop(root).open("term", [640, 480]);
      const term = windowFor(root, "term");
      expect(term.style.width).toBe("640px");
      expect(term.style.height).toBe("480px");
    });

    it("takes the placeholder down for a window that arrives already drawn", () => {
      // A size on the announcement means the client has committed at least
      // once, which is the replay a reloading chrome gets. No frame is coming
      // to say so: the hand-over skips a natively-drawn window, and
      // `app_resized` fires only when the size *changes*, so an idle client
      // never sends one. Without this the placeholder is painted over a live
      // window until the user happens to resize it.
      const root = freshRoot();
      new Desktop(root).open("term", [640, 480]);
      expect(windowFor(root, "term").classList).toContain("has-surface");
    });

    it("leaves it up for a client that has not drawn yet", () => {
      // No size is a client that has not committed, which is every client at
      // the moment it maps. That window really has nothing behind it, and the
      // placeholder is what says so until its first frame or resize.
      const root = freshRoot();
      new Desktop(root).open("term", undefined);
      expect(windowFor(root, "term").classList).not.toContain("has-surface");
    });

    it("opens each window clear of the last", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.open("editor", [640, 480]);
      expect(windowFor(root, "editor").style.top).not.toBe(
        windowFor(root, "term").style.top,
      );
    });

    it("holds one window for a client the host announces twice", () => {
      // The compositor broadcasts its open-window replay to every chrome on
      // any chrome's handshake, and states the invariant that makes that safe:
      // "a chrome that already holds the window ignores a second announcement
      // — the shell keys its windows by app id".
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      const moved = { height: 300, left: 10, top: 20, width: 400 };
      desktop.place("term", moved);

      desktop.open("term", [640, 480]);

      expect(
        root.querySelectorAll(`${APP_TAG_NAME}[app-id="term"]`).length,
      ).toBe(1);
      // And the one that is there is the one that was: a desktop that tore the
      // window down and built it again would pass the count and still lose
      // where the user had put it.
      expect(desktop.boxOf("term")).toStrictEqual(moved);
    });

    it("refuses to touch a window that is not on the desktop", () => {
      // Every caller has heard the host announce the client first — the
      // domicile client holds `app_appeared` until this shell is listening — so an app id it
      // has never seen is the two having gone out of step, not a case to
      // absorb.
      expect(() => new Desktop(freshRoot()).close("term")).toThrow(
        "no window for term",
      );
    });

    it("takes the window down when the client goes", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.close("term");
      expect(root.querySelector(APP_TAG_NAME)).toBeNull();
    });
  });

  describe("the keyboard", () => {
    it("gives it to a window opened on a desktop that is past its catch-up", () => {
      // Nothing else will. The SDK routes keys to whichever window was last
      // clicked, so without this Alt+Enter opens a terminal that hears nothing
      // until the user clicks it — and this shell's whole argument for
      // claiming that combination is that a desktop you cannot start anything
      // from is a demo.
      const { acted, desktop } = recordingDesktop();
      desktop.caughtUp();
      desktop.open("term", [640, 480]);
      expect(acted).toContain("focus:term");
    });

    it("leaves it alone for a window replayed while catching up", () => {
      // Every chrome that connects is replayed every window already running,
      // as if each had just appeared, and told who holds the keyboard at the
      // end. Focusing those would move the desktop's keyboard onto whichever
      // was replayed last and tell every other chrome so — throwing away an
      // answer the compositor already had, on every reload.
      const { acted, desktop } = recordingDesktop();
      desktop.open("term", [640, 480]);
      expect(acted).toStrictEqual([]);
    });
  });

  describe("placement", () => {
    it("moves and resizes the window it is given a box for", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.place("term", { height: 300, left: 10, top: 20, width: 400 });
      const term = windowFor(root, "term");
      expect(term.style.left).toBe("10px");
      expect(term.style.top).toBe("20px");
      expect(term.style.width).toBe("400px");
      expect(term.style.height).toBe("300px");
    });

    it("reports where a window is, so a drag can be measured from it", () => {
      const desktop = new Desktop(freshRoot());
      desktop.open("term", [640, 480]);
      const box = { height: 300, left: 10, top: 20, width: 400 };
      desktop.place("term", box);
      expect(desktop.boxOf("term")).toStrictEqual(box);
    });

    it("opens a window at the front of the stack, not behind the others", () => {
      // A window that opened behind the ones already there is one the user
      // asked for and cannot see. The stack is `z-index` on the element, which
      // is what the compositor draws by, so the element is what says so.
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.open("editor", [640, 480]);
      expect(Number(windowFor(root, "editor").style.zIndex)).toBeGreaterThan(
        Number(windowFor(root, "term").style.zIndex),
      );
    });

    it("puts a raised window above the others", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.open("editor", [640, 480]);
      desktop.raise("term");
      expect(Number(windowFor(root, "term").style.zIndex)).toBeGreaterThan(
        Number(windowFor(root, "editor").style.zIndex),
      );
    });
  });

  describe("what leaves", () => {
    it("tells a listener which window went, so nothing holds its id", () => {
      const desktop = new Desktop(freshRoot());
      const gone: string[] = [];
      desktop.onWindowClosed((appId) => gone.push(appId));
      desktop.open("term", [640, 480]);
      desktop.close("term");
      expect(gone).toStrictEqual(["term"]);
    });
  });

  describe("hit testing", () => {
    it("names the window an event landed in", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      expect(desktop.appIdAt(windowFor(root, "term"))).toBe("term");
    });

    it("names nothing for the desktop itself", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      expect(desktop.appIdAt(root)).toBeUndefined();
    });
  });

  describe("what the host pushes at a window", () => {
    it("takes the placeholder down when the client says how big it drew", () => {
      // The one thing `app_resized` is load-bearing for here: where the
      // compositor draws the client's own surface no frame ever arrives, so
      // this is what says the window has something behind it.
      //
      // Opened undrawn, and that is the whole test: a window opened at a size
      // already has the class before this line runs, so passing one here would
      // assert nothing about `resizeSurface`.
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", undefined);
      desktop.resizeSurface({ app_id: "term", size: [640, 480] });
      expect(windowFor(root, "term").classList).toContain("has-surface");
    });

    it("shows the cursor the client asked for", () => {
      const root = freshRoot();
      const desktop = new Desktop(root);
      desktop.open("term", [640, 480]);
      desktop.applyCursor({ app_id: "term", cursor: "text" });
      expect(windowFor(root, "term").style.cursor).toBe("text");
    });
  });
});
