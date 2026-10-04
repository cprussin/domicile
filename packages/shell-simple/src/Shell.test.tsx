import { beforeEach, describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { act, cleanup, render, screen } from "@testing-library/react";

import { Shell } from "./Shell";

/** The pointer every gesture here is made with, and the buttons it presses. */
const POINTER = 1;
const PRIMARY = 0;
const SECONDARY = 2;

/** `window.domicile`, under React's `act`. */
const acting = (fake: FakeDomicileHost) => ({
  appear: (...args: Parameters<FakeDomicileHost["appear"]>) => {
    act(() => {
      fake.appear(...args);
    });
  },
  change: (...args: Parameters<FakeDomicileHost["change"]>) => {
    act(() => {
      fake.change(...args);
    });
  },
  close: (appId: string) => {
    act(() => {
      fake.close(appId);
    });
  },
  focus: (appId: string | null) => {
    act(() => {
      fake.set({ focusedWindow: appId });
    });
  },
  press: (chord: string) => {
    act(() => {
      fake.dispatch("shortcut", { chord });
    });
  },
});

/** A rendered shell, with the host that drives it. */
const shell = (keybindings?: ShellKeybindings) => {
  const fake = new FakeDomicileHost();
  const reported: string[] = [];
  render(
    <Shell
      domicile={fake.host}
      keybindings={keybindings}
      report={(error) => {
        reported.push(error);
      }}
    />,
  );
  const called = (method: string) => () =>
    fake.calls.filter(([name]) => name === method).map(([, first]) => first);
  return {
    ...acting(fake),
    fake,
    focused: called("focusApp"),
    reported,
    spawned: called("spawn"),
  };
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

beforeEach(() => {
  cleanup();
});

describe("Shell", () => {
  describe("the windows", () => {
    it("mounts a window for a client the host announced, at the size it committed", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      const term = windowFor("term");
      expect(term.style.width).toBe("640px");
      expect(term.style.height).toBe("480px");
    });

    it("takes the window down when the client goes", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      host.close("term");
      expect(document.querySelector(APP_TAG_NAME)).toBeNull();
    });

    it("opens each window clear of the last, and in front of it", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      host.appear("editor", { height: 480, width: 640 });
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
      host.appear("term");
      expect(windowFor("term")).not.toHaveAttribute("data-drawn");
      host.change("term", { height: 480, width: 640 });
      expect(windowFor("term")).toHaveAttribute("data-drawn");
    });

    it("draws a client's menu over its window, and takes it down when it goes", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      const window = windowFor("term");

      host.appear("menu", {
        grab: true,
        height: 240,
        parent: "term",
        width: 180,
        x: 12,
        y: 30,
      });

      const menu = windowFor("menu");
      expect(menu.style.left).toBe(
        `${(Number.parseFloat(window.style.left) + 12).toString()}px`,
      );
      expect(menu.style.top).toBe(
        `${(Number.parseFloat(window.style.top) + 30).toString()}px`,
      );
      expect(menu.style.width).toBe("180px");
      expect(menu.style.height).toBe("240px");
      expect(menu.style.zIndex).toBe(window.style.zIndex);

      host.close("menu");
      expect(document.querySelector('[app-id="menu"]')).toBeNull();
      expect(windowFor("term")).toBeDefined();
    });

    it("marks a window that arrives already drawn", () => {
      // A size on the announcement is the replay a reconnecting chrome gets,
      // and no frame is coming to say so: the hand-over skips a natively-drawn
      // window and `app_resized` only fires on a size that changed.
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      expect(windowFor("term")).toHaveAttribute("data-drawn");
    });

    it("shows the cursor the client asked for", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      host.change("term", { cursor: "text" });
      expect(windowFor("term").style.cursor).toBe("text");
    });
  });

  describe("the keyboard", () => {
    it("gives it to a window opened once the host has caught up", () => {
      // Nothing else would: the SDK routes keys to whichever window was last
      // clicked, so without this a terminal opened from a key hears nothing.
      const host = shell();
      host.focus(null);
      host.appear("term");
      expect(host.focused()).toStrictEqual(["term"]);
    });

    it("leaves it alone for a window replayed while catching up", () => {
      // The replay is every window that was already running. Focusing those
      // would move the desktop's keyboard onto whichever came last, throwing
      // away an answer the compositor already had.
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      expect(host.focused()).toStrictEqual([]);
    });

    it("grabs the key it is given for a terminal, and opens one on it", () => {
      // Whatever key that is: `terminal` is the command, and the chord is the
      // shell's props'.
      const host = shell({
        keybindings: { "Meta+t": KeyAction.SendShell(["terminal"]) },
      });
      expect(host.fake.calls).toContainEqual(["grabShortcut", "Meta+t"]);
      host.press("Meta+t");
      host.press("Alt+Return");
      expect(host.spawned()).toStrictEqual([["kitty"]]);
    });

    it("says which command it does not know, and does nothing", () => {
      const host = shell({
        keybindings: { "Alt+Return": KeyAction.SendShell(["kill"]) },
      });
      host.press("Alt+Return");
      expect(host.spawned()).toStrictEqual([]);
      expect(host.reported).toStrictEqual(["simple: no command `kill`"]);
    });

    it("opens a terminal on Alt+Enter", () => {
      const host = shell();
      host.press("Alt+Return");
      expect(host.spawned()).toStrictEqual([["kitty"]]);
    });
  });

  describe("the gestures", () => {
    it("moves a window with an Alt drag", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
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
      host.appear("term", { height: 480, width: 640 });
      const term = windowFor("term");
      pointer("pointerdown", term, { button: SECONDARY, x: 100, y: 100 });
      pointer("pointermove", term, { button: SECONDARY, x: 110, y: 120 });
      expect(term.style.width).toBe("650px");
      expect(term.style.height).toBe("500px");
      expect(term.style.left).toBe("0px");
    });

    it("raises the window an Alt press lands on", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      host.appear("editor", { height: 480, width: 640 });
      pointer("pointerdown", windowFor("term"), { x: 10, y: 10 });
      expect(Number(windowFor("term").style.zIndex)).toBeGreaterThan(
        Number(windowFor("editor").style.zIndex),
      );
    });
  });

  describe("the legend", () => {
    it("names what the desktop answers to", () => {
      shell();
      expect(screen.getByText("Alt + drag")).toBeInTheDocument();
      expect(screen.getByText("Alt + Enter")).toBeInTheDocument();
    });

    it("stays on the background under a window that opened over it", () => {
      const host = shell();
      host.appear("term", { height: 480, width: 640 });
      expect(screen.getByText("Alt + drag")).toBeInTheDocument();
    });
  });
});
