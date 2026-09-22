import { beforeEach, describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type {
  HostMessageOf,
  HostMessageType,
} from "@domicile/chrome-sdk/host-message";
import { act, cleanup, render, screen } from "@testing-library/react";

import { Shell } from "./Shell";

/** The pointer every gesture here is made with, and the buttons it presses. */
const POINTER = 1;
const PRIMARY = 0;
const SECONDARY = 2;

type Host = {
  domicile: DomicileClient;
  /** Deliver a host message to the shell, as the control channel would. */
  emit: <T extends HostMessageType>(type: T, message: HostMessageOf<T>) => void;
  focused: string[];
  spawned: (readonly string[])[];
};

/** A domicile client that records what the shell asked of it. */
const fakeHost = (): Host => {
  const handlers = new Map<string, (message: never) => void>();
  const host: Host = {
    domicile: {
      focusApp: (appId: string) => host.focused.push(appId),
      grabShortcut: () => undefined,
      on: (type: string, handler: (message: never) => void) => {
        handlers.set(type, handler);
      },
      spawn: (command: readonly string[]) => host.spawned.push(command),
    } as unknown as DomicileClient,
    emit: (type, message) => {
      act(() => {
        handlers.get(type)?.(message as never);
      });
    },
    focused: [],
    spawned: [],
  };
  return host;
};

/** A rendered shell, with the client that drives it. */
const shell = (): Host => {
  const host = fakeHost();
  render(<Shell domicile={host.domicile} />);
  return host;
};

/** The window the desktop is showing for `appId`. */
const windowFor = (appId: string): HTMLElement => {
  const element = document.querySelector(
    `${APP_TAG_NAME}[app-id="${appId}"]`,
  ) as HTMLElement | null;
  if (element === null) {
    throw new Error(`test: the desktop is showing no window for ${appId}`);
  } else {
    return element;
  }
};

const pointer = (
  type: string,
  target: EventTarget,
  { button = PRIMARY, x, y }: { button?: number; x: number; y: number },
): void => {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        altKey: true,
        bubbles: true,
        button,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: POINTER,
      }),
    );
  });
};

const press = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
): void => {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        cancelable: true,
        key,
        ...modifiers,
      }),
    );
  });
};

beforeEach(() => {
  cleanup();
});

describe("Shell", () => {
  describe("the windows", () => {
    it("mounts a window for a client the host announced, at the size it committed", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      const term = windowFor("term");
      expect(term.style.width).toBe("640px");
      expect(term.style.height).toBe("480px");
    });

    it("holds one window for a client the host announces twice", () => {
      // The compositor replays every open window to every chrome whenever any
      // chrome connects, so a second announcement is news to nobody — and a
      // second element would leave the first orphaned, still embedding the
      // same surface and configuring the same client.
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      expect(
        document.querySelectorAll(`${APP_TAG_NAME}[app-id="term"]`).length,
      ).toBe(1);
    });

    it("takes the window down when the client goes", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      host.emit("app_closed", { app_id: "term" });
      expect(document.querySelector(APP_TAG_NAME)).toBeNull();
    });

    it("opens each window clear of the last, and in front of it", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      host.emit("app_appeared", {
        app_id: "editor",
        size: [640, 480],
        title: undefined,
      });
      expect(windowFor("editor").style.top).not.toBe(
        windowFor("term").style.top,
      );
      expect(Number(windowFor("editor").style.zIndex)).toBeGreaterThan(
        Number(windowFor("term").style.zIndex),
      );
    });
  });

  describe("what the host pushes at a window", () => {
    it("marks a window drawn when the client says how big it drew", () => {
      // Until then the window has nothing behind it, and says so with a
      // placeholder the stylesheet hangs off the absence of this attribute.
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: undefined,
        title: undefined,
      });
      expect(windowFor("term")).not.toHaveAttribute("data-drawn");
      host.emit("app_resized", { app_id: "term", size: [640, 480] });
      expect(windowFor("term")).toHaveAttribute("data-drawn");
    });

    it("marks a window that arrives already drawn", () => {
      // A size on the announcement is the replay a reconnecting chrome gets,
      // and no frame is coming to say so: the hand-over skips a natively-drawn
      // window and `app_resized` only fires on a size that changed.
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      expect(windowFor("term")).toHaveAttribute("data-drawn");
    });

    it("shows the cursor the client asked for", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      host.emit("app_cursor", { app_id: "term", cursor: "text" });
      expect(windowFor("term").style.cursor).toBe("text");
    });
  });

  describe("the keyboard", () => {
    it("gives it to a window opened once the host has caught up", () => {
      // Nothing else would: the SDK routes keys to whichever window was last
      // clicked, so without this Alt+Enter opens a terminal that hears nothing.
      const host = shell();
      host.emit("focus_changed", { app_id: undefined });
      host.emit("app_appeared", {
        app_id: "term",
        size: undefined,
        title: undefined,
      });
      expect(host.focused).toStrictEqual(["term"]);
    });

    it("leaves it alone for a window replayed while catching up", () => {
      // The replay is every window that was already running. Focusing those
      // would move the desktop's keyboard onto whichever came last, throwing
      // away an answer the compositor already had.
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      expect(host.focused).toStrictEqual([]);
    });

    it("opens a terminal on Alt+Enter in the page", () => {
      const host = shell();
      press("Enter");
      expect(host.spawned).toStrictEqual([["kitty"]]);
    });

    it("leaves other chords to whichever window has the keyboard", () => {
      const host = shell();
      press("Enter", { shiftKey: true });
      expect(host.spawned).toStrictEqual([]);
    });

    it("opens a terminal on the shortcut the compositor claims", () => {
      // The other half of the same chord: once a client holds the keyboard the
      // page never hears the press, so the compositor sends it back instead.
      const host = shell();
      host.emit("shortcut", {
        altKey: true,
        ctrlKey: false,
        keycode: 28,
        metaKey: false,
        shiftKey: false,
      });
      expect(host.spawned).toStrictEqual([["kitty"]]);
    });
  });

  describe("the gestures", () => {
    it("moves a window with an Alt drag", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      const term = windowFor("term");
      pointer("pointerdown", term, { x: 100, y: 100 });
      pointer("pointermove", term, { x: 130, y: 150 });
      pointer("pointerup", term, { x: 130, y: 150 });
      expect(term.style.left).toBe("30px");
      expect(term.style.top).toBe("50px");
      expect(term.style.width).toBe("640px");
    });

    it("resizes it with an Alt drag of the secondary button", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      const term = windowFor("term");
      pointer("pointerdown", term, { button: SECONDARY, x: 100, y: 100 });
      pointer("pointermove", term, { button: SECONDARY, x: 110, y: 120 });
      expect(term.style.width).toBe("650px");
      expect(term.style.height).toBe("500px");
      expect(term.style.left).toBe("0px");
    });

    it("raises the window an Alt press lands on", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      host.emit("app_appeared", {
        app_id: "editor",
        size: [640, 480],
        title: undefined,
      });
      pointer("pointerdown", windowFor("term"), { x: 10, y: 10 });
      expect(Number(windowFor("term").style.zIndex)).toBeGreaterThan(
        Number(windowFor("editor").style.zIndex),
      );
    });
  });

  describe("the legend", () => {
    it("names the keys the desktop answers to", () => {
      shell();
      expect(screen.getByText("Alt + Enter")).toBeInTheDocument();
    });

    it("stays on the background under a window that opened over it", () => {
      const host = shell();
      host.emit("app_appeared", {
        app_id: "term",
        size: [640, 480],
        title: undefined,
      });
      expect(screen.getByText("Alt + Enter")).toBeInTheDocument();
    });
  });
});
