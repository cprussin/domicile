import { beforeEach, describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { DomicileDisplay } from "@domicile/chrome-sdk/domicile-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { codeFor } from "./keyboard/programmers-dvorak";
import { Shell } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { TITLE_BAR } from "./window-management/rect";

// The desktop as the *engine* describes it: a corner and an extent as four
// numbers, which `screens/host-displays.ts` is what regroups into the rectangle
// the component library lays out against. The double below holds this shape
// rather than that one, so the mapping is exercised by every render here.
//
// Both lie down and neither is a window of its own, which is the desktop this
// file is about: two monitors of one page. A screen that IS its window is
// `host-displays.test.ts`.
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

const RIGHT: DomicileDisplay = {
  fillsTheWindow: false,
  height: 1024,
  modeHeight: 1024,
  modeWidth: 1280,
  name: "right",
  scale: 1,
  transform: "normal",
  width: 1280,
  x: 1920,
  y: 0,
};

/** How tall the top bar is, which the windows below it start under. */
const TOP_BAR = 32;

/** The region a `<Screen>` renders for the display of this name. */
const screenNamed = (container: HTMLElement, name: string): Element | null =>
  container.querySelector(`[data-screen="${name}"]`);

type Call = readonly [kind: string, ...args: unknown[]];

// A double that both records what the chrome asks of the host and emits the
// host events the chrome reacts to.
class FakeDomicile {
  readonly calls: Call[] = [];

  /**
   * The desktop, retained the way the real client retains it: a description is
   * a fact rather than an event, and the chrome reads it as often as it is
   * told it.
   */
  displays: readonly DomicileDisplay[] | undefined;

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
  describes(displays: readonly DomicileDisplay[]): void {
    this.displays = displays;
    this.emit("displays", { displays });
  }

  emit(type: string, message: Record<string, unknown>): void {
    act(() => {
      this.#handlers.get(type)?.({ type, ...message });
    });
  }

  resizeApp(appId: string, size: readonly number[]): void {
    this.calls.push(["resize", appId, size]);
  }
  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
  }
  listFiles(): void {
    this.calls.push(["listFiles"]);
  }
  grabShortcut(shortcut: unknown): void {
    this.calls.push(["grabShortcut", shortcut]);
  }
  focusApp(appId: string): void {
    this.calls.push(["focusApp", appId]);
  }
  // The portal forwards the keys a focused window is given, so the shell's own
  // keystrokes reach this once a window has the keyboard.
  key(appId: string, keycode: number, pressed: boolean): void {
    this.calls.push(["key", appId, keycode, pressed]);
  }
  focusChrome(): void {
    this.calls.push(["focusChrome"]);
  }
  // What each client has drawn is the SDK's to remember, and the SDK reads it
  // back off the client rather than off any element. Nothing here is about the
  // pointer mapping that uses it, so every window maps its own box 1:1.
  surfaceSizeOf(): undefined {
    return undefined;
  }
  closeApp(appId: string): void {
    this.calls.push(["closeApp", appId]);
  }
}

let domicile: FakeDomicile;

/**
 * Renders the chrome on a desktop of `desktop`.
 *
 * Described *before* the first render by default, the way a shell that has
 * completed its handshake is: the chrome renders nothing until there is a
 * desktop to put it on. The tests that care about the gap pass `undefined` and
 * describe one themselves.
 */
const renderingShell = (desktop: readonly DomicileDisplay[] | undefined) => {
  domicile = new FakeDomicile();
  domicile.displays = desktop;
  const client = domicile as unknown as DomicileClient;
  registerElements(client, {
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves.
    },
  });
  return render(<Shell displays={hostDisplays(client)} domicile={client} />);
};

/** The chrome on a desktop the host has already described. */
const renderShell = (desktop: readonly DomicileDisplay[] = [LEFT]) =>
  renderingShell(desktop);

/**
 * The chrome before any desktop has been described — the gap between the page
 * loading and the host answering, and the whole of a shell that has no host.
 */
const renderUndescribedShell = () => renderingShell(undefined);

/** A client the host announces, which is a window on the desktop. */
const clientAppears = (appId: string, title = appId): void => {
  domicile.emit("app_appeared", { app_id: appId, title });
};

/**
 * A chord pressed on this page, which is where every press the desktop's own
 * chrome or a focused Wayland window hears arrives.
 *
 * By the *key* rather than by the letter on it: the bindings are physical, so
 * a test presses `codeFor("h")` — the key Programmer's Dvorak puts `h` on —
 * exactly as the shell reads it.
 */
const press = (keysym: string, shift = false): void => {
  fireEvent.keyDown(document, {
    code: codeFor(keysym),
    metaKey: true,
    shiftKey: shift,
  });
};

/** The same chord, handed back by the host — what a focused `<webview>` does. */
const hostPress = (keysym: string, shift = false): void => {
  const keycode = KEYCODES[keysym];
  if (keycode === undefined) {
    throw new Error(`test: no evdev code written down for ${keysym}`);
  } else {
    domicile.emit("shortcut", {
      altKey: false,
      ctrlKey: false,
      keycode,
      metaKey: true,
      shiftKey: shift,
    });
  }
};

/**
 * The evdev codes of the keys these tests hand back through the host.
 *
 * Written out rather than read off the bindings: what this checks is that the
 * shell answers the code the compositor was given, so taking the number from
 * the same table would check nothing.
 */
const KEYCODES: Readonly<Record<string, number>> = {
  Return: 28,
  space: 57,
  Tab: 15,
};

/** What the page holds down, which is what hands the shell the pointer. */
const pageHolds = (held: { meta?: boolean; shift?: boolean }): void => {
  fireEvent.keyDown(document, {
    code: "MetaLeft",
    key: "Meta",
    metaKey: held.meta ?? false,
    shiftKey: held.shift ?? false,
  });
};

/** The windows on screen, by the client or the kind of window each one is. */
const windowsOnScreen = (container: HTMLElement): string[] =>
  [
    ...container.querySelectorAll(
      `main ${APP_TAG_NAME}:not([hidden]), main section:not([hidden])`,
    ),
  ].map(
    (element) =>
      element.getAttribute("app-id") ??
      element.getAttribute("aria-label") ??
      "",
  );

/** Every window's title bar, in the order the windows were opened. */
const titleBars = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>(
    "[data-window]:not([aria-hidden])",
  ),
];

const barFor = (container: HTMLElement, id: string): HTMLElement => {
  const bar = titleBars(container).find((found) => found.dataset.window === id);
  if (bar === undefined) {
    throw new Error(`test: no title bar for ${id}`);
  } else {
    return bar;
  }
};

/** Everything on screen that is arriving or leaving, and what each is doing. */
const moving = (container: HTMLElement): string[] =>
  [
    ...container.querySelectorAll<HTMLElement>(
      '[data-motion]:not([data-motion="resting"])',
    ),
  ].map((element) => element.dataset.motion ?? "");

/** The parts of one window that are arriving or leaving. */
const movingParts = (container: HTMLElement, motion: string): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>(`[data-motion="${motion}"]`),
];

/**
 * Everything that is arriving or leaving says it has finished.
 *
 * What a browser does by itself, and what nothing in a test DOM does: the
 * shell goes on drawing a window it has closed, and the workspace it has just
 * left, until the elements say their animations have ended. A case about what
 * the desktop shows *afterwards* has to play them out first.
 */
const motionsPlayOut = (container: HTMLElement): void => {
  for (const element of container.querySelectorAll(
    '[data-motion]:not([data-motion="resting"])',
  )) {
    fireEvent.animationEnd(element);
  }
};

/** The sheet a drag is caught on, over one floating window. */
const grabSheets = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-window][aria-hidden]"),
];

const appElement = (container: HTMLElement, appId: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(
    `${APP_TAG_NAME}[app-id="${appId}"]`,
  );
  if (element === null) {
    throw new Error(`test: no window for ${appId}`);
  } else {
    return element;
  }
};

/** Where an element was placed, as the numbers the layout worked out. */
const boxOf = (element: HTMLElement) => ({
  height: element.style.blockSize,
  width: element.style.inlineSize,
  x: element.style.insetInlineStart,
  y: element.style.insetBlockStart,
});

/**
 * The machine's battery, which happy-dom has none of and the shell asks the
 * platform for. Held open rather than answered on its own: the bar draws no
 * meter until the platform has, so a case that wants one settles this itself,
 * and every other case here stays synchronous.
 */
const platform: { answers?: (battery: BatteryManager) => void } = {};

/** The platform answering with a battery in the state the case is about. */
const machineAnswers = (reading: {
  charging: boolean;
  level: number;
}): void => {
  if (platform.answers === undefined) {
    throw new Error("test: nothing has asked the platform for a battery");
  } else {
    platform.answers(Object.assign(new EventTarget(), reading));
  }
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  // happy-dom implements no Battery Status API, and the shell throws rather
  // than draw a desktop it cannot read the charge of.
  navigator.getBattery = () =>
    new Promise((resolve) => {
      platform.answers = resolve;
    });
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
      renderShell([]);

      expect(
        screen.getByRole("heading", { name: "No screens" }),
      ).toBeInTheDocument();
    });

    it("says nothing of the kind before the host has described anything", () => {
      renderUndescribedShell();

      expect(
        screen.queryByRole("heading", { name: "No screens" }),
      ).not.toBeInTheDocument();
    });

    it("renders nothing until the desktop is described", () => {
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
      clientAppears("term", "Terminal");

      domicile.describes([LEFT]);

      expect(
        screenNamed(container, "left")?.querySelector(APP_TAG_NAME),
      ).toBeInTheDocument();
    });

    it("follows the desktop when it changes", () => {
      const { container } = renderShell([LEFT, RIGHT]);

      const stage = screenNamed(container, "left")?.querySelector("main");
      domicile.describes([RIGHT]);

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

  describe("the wallpaper", () => {
    it("hangs behind every screen rather than inside one", () => {
      const { container } = renderShell([LEFT, RIGHT]);

      expect(
        container.querySelector("[data-screen] [data-wallpaper]"),
      ).toBeNull();
      expect(
        container.firstElementChild?.querySelector("[data-wallpaper]"),
      ).toBeInTheDocument();
    });

    it("is up before the host has described a desktop", () => {
      const { container } = renderUndescribedShell();

      expect(container.querySelector("[data-wallpaper]")).toBeInTheDocument();
    });
  });

  describe("the top bar", () => {
    it("draws its text white, with a shadow to keep it off the wallpaper", () => {
      // The bar paints no background, so nothing else separates its text from
      // whatever photograph is behind it. Declarations rather than a class
      // name, because Panda hashes them: the check is that the element carries
      // *these rules*.
      const { container } = renderShell();

      const bar = container.querySelector("header");
      expect(bar?.className).toContain(css({ color: "white" }));
      expect(bar?.className).toContain(css({ textShadow: "textOverPhoto" }));
    });

    it("reads the date and the time down to the second", () => {
      renderShell();

      expect(
        screen.getByText(/^\w+ \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      ).toBeInTheDocument();
    });

    it("shows the workspace on screen and the ones with windows on them", () => {
      // sway's own bar: an empty workspace nobody is looking at is not on it.
      renderShell();
      clientAppears("term");
      press("parenright");

      const workspaces = screen.getByRole("navigation", {
        name: "Workspaces",
      });
      expect(
        [...workspaces.querySelectorAll("button")].map(
          (button) => button.textContent,
        ),
      ).toEqual(["1", "2"]);
    });

    it("marks the workspace on screen", () => {
      renderShell();
      clientAppears("term");
      press("parenright");

      expect(screen.getByRole("button", { name: "2" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("switches workspace when one is picked", async () => {
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");
      press("parenright");

      await user.click(screen.getByRole("button", { name: "1" }));

      expect(windowsOnScreen(container)).toEqual(["term"]);
    });

    it("says when the keys are in resize mode", () => {
      renderShell();
      clientAppears("term");

      press("r");

      expect(screen.getByText("resize")).toBeInTheDocument();
    });

    it("shows the charge, and the plug when AC is in", async () => {
      renderShell();

      machineAnswers({ charging: true, level: 0.42 });

      expect(await screen.findByText("42%")).toBeVisible();
      expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
        "aria-valuenow",
        "42",
      );
      expect(screen.getByRole("img", { name: "Charging" })).toBeVisible();
    });

    it("launches nothing: the keys are what does things to the desktop", () => {
      // The two launchers were here and are not. `mod+Return` is still the
      // terminal and `mod+Space` is the launcher, which is what opens a window
      // on a URL or a search — and a bar with a button for two of the
      // desktop's keys was a ranking of them that nobody made.
      renderShell();

      expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull();
      expect(screen.queryByRole("button", { name: "New window" })).toBeNull();
      expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
    });
  });

  describe("the windows", () => {
    it("tiles a client's window over the whole workspace", () => {
      // One window, so `gaps.smartGaps` leaves it the screen — under the bar,
      // which is what the desktop takes off the top before laying anything
      // out.
      const { container } = renderShell();
      clientAppears("term");

      expect(boxOf(appElement(container, "term"))).toEqual({
        height: `${(1080 - TOP_BAR - TITLE_BAR).toString()}px`,
        width: "1920px",
        x: "0px",
        y: `${(TOP_BAR + TITLE_BAR).toString()}px`,
      });
    });

    it("gives every window a title bar with what it is called on it", () => {
      const { container } = renderShell();
      clientAppears("term", "Terminal");

      const bar = barFor(container, "app:term");
      expect(bar).toHaveTextContent("Terminal");
      expect(boxOf(bar)).toMatchObject({
        height: `${TITLE_BAR.toString()}px`,
        y: `${TOP_BAR.toString()}px`,
      });
    });

    it("renames the bar when the client renames its window", () => {
      const { container } = renderShell();
      clientAppears("term", "Terminal");

      domicile.emit("app_titled", { app_id: "term", title: "vim ~/notes" });

      expect(barFor(container, "app:term")).toHaveTextContent("vim ~/notes");
    });

    it("splits the workspace between two windows, with the config's gap", () => {
      // `gaps.inner = 20`: 1900 of the 1920 is shared out.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(boxOf(appElement(container, "one"))).toMatchObject({
        width: "950px",
        x: "0px",
      });
      expect(boxOf(appElement(container, "two"))).toMatchObject({
        width: "950px",
        x: "970px",
      });
    });

    it("asks a client to close its own window", async () => {
      // `closeApp` is a request: an editor with unsaved work may put a dialog
      // up and stay, so the window goes when the host says it went.
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");

      await user.click(screen.getByRole("button", { name: "Close" }));

      expect(domicile.calls).toContainEqual(["closeApp", "term"]);
      expect(windowsOnScreen(container)).toEqual(["term"]);
    });

    it("fills the screen from the button on the window's own bar", async () => {
      // `mod+f`, reached with the pointer instead: the same toggle, on the
      // window whose bar was pressed.
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");

      await user.click(screen.getByRole("button", { name: "Maximize" }));

      // Over the top bar as well, which is what a fullscreen window covers.
      expect(boxOf(appElement(container, "term"))).toMatchObject({
        height: `${(1080 - TITLE_BAR).toString()}px`,
        y: `${TITLE_BAR.toString()}px`,
      });

      // And the same button is what gives the desktop back.
      await user.click(screen.getByRole("button", { name: "Restore" }));

      expect(boxOf(appElement(container, "term"))).toMatchObject({
        y: `${(TOP_BAR + TITLE_BAR).toString()}px`,
      });
    });

    it("takes the window away when the client goes", () => {
      const { container } = renderShell();
      clientAppears("term");

      domicile.emit("app_closed", { app_id: "term" });
      motionsPlayOut(container);

      expect(windowsOnScreen(container)).toEqual([]);
    });

    // A CLOSE IS THE ONE CHANGE THE DESKTOP CANNOT DRAW. Every other one ends
    // with the desktop as it now is; this one ends with the window gone from
    // the list, its workspace and the layout at once, so the page goes on
    // drawing it from a record of what it was — see `closing.ts`.
    it("plays a closed window out at the box it had, showing the window itself", () => {
      const { container } = renderShell();
      clientAppears("term");
      const was = boxOf(appElement(container, "term"));

      domicile.emit("app_closed", { app_id: "term" });

      // The window's own element, not something standing in for it: what a
      // window shows must not change while the user watches it go.
      expect(appElement(container, "term")).toHaveAttribute(
        "data-motion",
        "closing",
      );
      expect(boxOf(appElement(container, "term"))).toEqual(was);
    });

    // AND GOES ON SAYING WHAT IT SAID. Closing a window moves the keyboard to
    // whatever is left, so a bar drawn from the desktop as it now is would
    // lose its fill half way through the window's own departure.
    it("keeps its bar saying the keyboard was in it while it goes", () => {
      const { container } = renderShell();
      clientAppears("term");
      clientAppears("editor");

      domicile.emit("app_closed", { app_id: "editor" });

      expect(barFor(container, "app:editor")).toHaveAttribute(
        "data-focus",
        "focused",
      );
    });

    // AND IS DRAWN OVER THE WINDOW MOVING INTO ITS PLACE. The neighbour eases
    // into the box it had while it shrinks away inside it, and at the depth it
    // used to have the neighbour would cover it before it had gone — two
    // elements at one `z-index` are decided by the order they come in the
    // document, and a closing window goes on being drawn where it always was.
    it("draws a closing window over the one taking its space", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      domicile.emit("app_closed", { app_id: "one" });

      expect(Number(appElement(container, "one").style.zIndex)).toBeGreaterThan(
        Number(appElement(container, "two").style.zIndex),
      );
    });

    it("takes it off the page once it has finished leaving", () => {
      const { container } = renderShell();
      clientAppears("term");
      domicile.emit("app_closed", { app_id: "term" });

      motionsPlayOut(container);

      expect(movingParts(container, "closing")).toEqual([]);
      expect(windowsOnScreen(container)).toEqual([]);
    });

    it("keeps a window that is on another workspace mounted and hidden", () => {
      // Hidden rather than unmounted: a portal re-created is a portal blank,
      // and an embedded page remounted is a page reloaded.
      const { container } = renderShell();
      clientAppears("term");

      press("parenright");
      motionsPlayOut(container);

      expect(windowsOnScreen(container)).toEqual([]);
      expect(appElement(container, "term")).toBeInTheDocument();
    });

    // A WORKSPACE SWITCH IS THE ONE CHANGE ON THIS DESKTOP WITH A DIRECTION.
    // The workspaces are a row: the one arriving comes in from the side it was
    // on and the one being left goes the other way, so the two pass each
    // other rather than one blinking out and the other blinking in.
    it("slides one workspace off as the next one slides in", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("braceright");
      clientAppears("editor");

      press("parenleft");

      expect(moving(container)).toContain("leaving-to-end");
      expect(moving(container)).toContain("arriving-from-start");
    });

    it("and the other way when the switch goes the other way", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("braceright");

      expect(moving(container)).toContain("leaving-to-start");
    });

    // A WINDOW SIMPLY COMING BACK INTO VIEW IS NOT A WINDOW OPENING. It has
    // been on the desktop the whole time, and a desktop that played an
    // arrival for it would announce every window on a workspace as new every
    // time the workspace was reached.
    it("does not play a window in when a workspace switch reveals it", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("braceright");
      motionsPlayOut(container);

      press("parenleft");
      motionsPlayOut(container);

      expect(moving(container)).toEqual([]);
    });
  });

  describe("which window has the keyboard", () => {
    it("marks the focused window's bar and leaves the others resting", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(barFor(container, "app:two").dataset.focus).toBe("focused");
      expect(barFor(container, "app:one").dataset.focus).toBe("resting");
      // And the mark is a filled bar rather than a hairline: the one thing on
      // a desktop of identical frames that says where the keystrokes go.
      expect(barFor(container, "app:two").className).toContain(
        css({ backgroundColor: "accent" }),
      );
      expect(barFor(container, "app:one").className).not.toContain(
        css({ backgroundColor: "accent" }),
      );
    });

    it("moves the mark with the focus", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("h");

      expect(barFor(container, "app:one").dataset.focus).toBe("focused");
      expect(barFor(container, "app:two").dataset.focus).toBe("resting");
    });

    it("draws the focused window's own frame in the accent as well", () => {
      // The bar is one edge of the window; a frame that stayed the resting
      // colour would say something different from the bar above it.
      // Declarations rather than class names, because Panda hashes them.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(appElement(container, "two").className).toContain(
        css({ borderColor: "accent" }),
      );
      expect(appElement(container, "one").className).toContain(
        css({ borderColor: "borderStrong" }),
      );
    });
  });

  describe("the keys, as the sway config binds them", () => {
    it("claims every chord it answers from the compositor", () => {
      // Which is what answers a press while a `<webview>` has the keyboard:
      // the browser process is the only layer above a guest.
      renderShell();

      expect(domicile.calls).toContainEqual([
        "grabShortcut",
        {
          altKey: false,
          ctrlKey: false,
          keycode: KEYCODES.Return,
          metaKey: true,
          shiftKey: false,
        },
      ]);
    });

    it("spawns a terminal on the chord the config names", () => {
      renderShell();

      press("Return");

      expect(domicile.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("answers the same chord handed back by the host", () => {
      // A browser window has the keyboard, so the press never reaches this
      // document: it arrives as a `shortcut` message instead.
      renderShell();

      hostPress("Return");

      expect(domicile.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("moves the focus with the direction keys", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("h");

      // The bar of the window being worked in is the one drawn as focused,
      // which is the only thing on screen that says where the keyboard is.
      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
      expect(barFor(container, "app:one").className).not.toBe(
        barFor(container, "app:two").className,
      );
    });

    it("moves a window through the tiling with Shift held", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("h", true);

      expect(boxOf(appElement(container, "two"))).toMatchObject({ x: "0px" });
      expect(boxOf(appElement(container, "one"))).toMatchObject({ x: "970px" });
    });

    it("lays the container out in tabs, which are the windows' own bars", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("w");

      // One tab each across the top, and only the focused window's contents
      // under them.
      expect(boxOf(barFor(container, "app:one"))).toMatchObject({
        width: "960px",
        x: "0px",
      });
      expect(windowsOnScreen(container)).toEqual(["two"]);
    });

    it("fills the screen with the window being worked in", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("f");

      // Over the bar as well, which is what a fullscreen window covers.
      expect(boxOf(appElement(container, "term"))).toMatchObject({
        height: `${(1080 - TITLE_BAR).toString()}px`,
        y: `${TITLE_BAR.toString()}px`,
      });
    });

    it("spreads a global fullscreen across every screen", () => {
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("term");

      press("f", true);

      expect(boxOf(appElement(container, "term"))).toMatchObject({
        width: `${(1920 + 1280).toString()}px`,
      });
    });

    it("sends a window to another workspace and stays put", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("parenright", true);

      expect(windowsOnScreen(container)).toEqual(["one"]);
      press("parenright");
      // Once the workspace it was on has finished sliding off: `one` is drawn
      // for as long as that takes.
      motionsPlayOut(container);
      expect(windowsOnScreen(container)).toEqual(["two"]);
    });

    it("goes back to the last workspace when the same key is pressed", () => {
      // `workspaceAutoBackAndForth = true`.
      const { container } = renderShell();
      clientAppears("term");

      press("parenright");
      press("parenright");

      expect(windowsOnScreen(container)).toEqual(["term"]);
    });

    it("resizes the tiling in the mode the config's `mod+r` enters", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("r");
      press("l");

      // The window being worked in grows and the one beside it gives way.
      expect(
        Number.parseFloat(appElement(container, "two").style.inlineSize),
      ).toBeGreaterThan(950);
      press("Return");
      expect(screen.queryByText("resize")).not.toBeInTheDocument();
    });

    it("closes the window being worked in", () => {
      renderShell();
      clientAppears("term");

      press("q", true);

      expect(domicile.calls).toContainEqual(["closeApp", "term"]);
    });
  });

  describe("floating windows", () => {
    it("takes a window out of the tiling and puts it back", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("Tab", true);

      // A box of its own rather than the whole workspace, and over it.
      const floated = boxOf(appElement(container, "term"));
      expect(floated.width).not.toBe("1920px");
      expect(
        Number(appElement(container, "term").style.zIndex),
      ).toBeGreaterThan(0);

      press("Tab", true);
      expect(boxOf(appElement(container, "term"))).toMatchObject({
        width: "1920px",
      });
    });

    it("swaps the keyboard between the floating window and the tiling", () => {
      renderShell();
      clientAppears("one");
      clientAppears("two");

      press("Tab", true);
      domicile.calls.length = 0;
      press("Tab");

      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
    });

    it("puts a sheet over a float to catch a drag while the modifier is held", () => {
      // The pointer over a client's surface belongs to the client, so the
      // shell has to be handed it back before it can be told where a window
      // is being dragged to.
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      // Let go of the chord that floated it: the sheet is up while the
      // modifier is held, and the chord held it.
      pageHolds({});
      expect(grabSheets(container)).toHaveLength(0);

      pageHolds({ meta: true });
      expect(grabSheets(container)).toHaveLength(1);
    });

    it("moves a floating window by its title bar, with no modifier held", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);
      const bar = barFor(container, "app:term");
      const was = Number.parseFloat(bar.style.insetInlineStart);

      fireEvent.pointerDown(bar, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 100 });
      fireEvent.pointerUp(window, { clientX: 140, clientY: 100 });

      expect(
        Number.parseFloat(barFor(container, "app:term").style.insetInlineStart),
      ).toBe(was + 40);
    });

    it("keys a floating window around the desktop instead of retiling it", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);
      const was = Number.parseFloat(
        appElement(container, "term").style.insetInlineStart,
      );

      press("l", true);

      expect(
        Number.parseFloat(appElement(container, "term").style.insetInlineStart),
      ).toBeGreaterThan(was);
    });

    it("stacks each float over the one behind it", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("Tab", true);
      press("Tab");
      press("Tab", true);

      expect(Number(appElement(container, "one").style.zIndex)).toBeGreaterThan(
        Number(appElement(container, "two").style.zIndex),
      );
    });
  });

  describe("the scratchpad", () => {
    it("takes a window off the desktop and brings it back floating", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("minus", true);
      expect(windowsOnScreen(container)).toEqual([]);

      press("minus");
      expect(windowsOnScreen(container)).toEqual(["term"]);
      expect(
        Number(appElement(container, "term").style.zIndex),
      ).toBeGreaterThan(0);
    });
  });

  describe("focus follows the cursor", () => {
    it("gives the keyboard to the window the pointer moves into", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      domicile.calls.length = 0;

      act(() => {
        appElement(container, "one").dispatchEvent(
          new MouseEvent("pointerover", { bubbles: true }),
        );
      });

      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
    });

    it("leaves the keyboard where it is when the pointer lands on the chrome", () => {
      // The bar, the wallpaper and a float's own furniture are not windows:
      // handing the keyboard back for them would make the desktop untypeable
      // whenever the pointer came to rest on anything.
      const { container } = renderShell();
      clientAppears("term");
      domicile.calls.length = 0;

      act(() => {
        barFor(container, "app:term").dispatchEvent(
          new MouseEvent("pointerover", { bubbles: true }),
        );
      });

      expect(domicile.calls).toEqual([]);
    });

    it("grants a client that asks for the keyboard over xdg-activation", () => {
      renderShell();
      clientAppears("one");
      clientAppears("two");
      press("parenright");
      domicile.calls.length = 0;

      domicile.emit("focus_requested", { app_id: "one" });

      // Granted, and on the workspace the window is on — which is what makes
      // granting it mean anything.
      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
      expect(screen.getByRole("button", { name: "1" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("follows the seat when the compositor moves the keyboard itself", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      domicile.emit("focus_changed", { app_id: "one" });

      expect(barFor(container, "app:one").className).not.toBe(
        barFor(container, "app:two").className,
      );
    });
  });
});

describe("the launcher", () => {
  /**
   * The launcher's own box, which is not the only combobox a desktop can have
   * on screen: a browser window's address bar is one too, so the box is named
   * and matched by name.
   */
  const launcherBox = (): HTMLElement | null =>
    screen.queryByRole("combobox", { name: "Open a file, a URL, or search" });

  /** The same box where a case needs it to be there. */
  const typeIntoLauncher = async (typed: string): Promise<void> => {
    await userEvent
      .setup()
      .type(
        screen.getByRole("combobox", { name: "Open a file, a URL, or search" }),
        typed,
      );
  };

  /** Where each browser window on the desktop was pointed. */
  const browsing = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("webview")].map(
      (view) => view.getAttribute("src") ?? "",
    );

  /** The host answering a `list_files`, which is what fills the panel. */
  const homeHolds = (...files: readonly string[]): void => {
    domicile.emit("files", { files });
  };

  it("is not on screen until the key that opens it", () => {
    renderShell();

    expect(launcherBox()).toBeNull();
  });

  it("opens on mod+space and asks the host what there is to open", () => {
    // The ask rides with the opening rather than with the shell starting: a
    // home directory changes for reasons nothing here is watching, so the list
    // has to be current at the moment the panel is.
    renderShell();

    press("space");

    expect(launcherBox()).toBeVisible();
    expect(domicile.calls).toContainEqual(["listFiles"]);
  });

  it("shows the files the host answered with", () => {
    renderShell();
    press("space");

    homeHolds("Notes/today.org", "todo.txt");

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(["Notes/today.org", "todo.txt"]);
  });

  it("opens a file in the user's editor and puts the panel away", async () => {
    // `$EDITOR` and `$HOME` are read by the spawned shell, because they exist
    // there and nowhere this page can see. See `launcher/editor-command.ts`.
    renderShell();
    press("space");
    homeHolds("Notes/today.org");

    await userEvent.setup().click(screen.getByRole("option"));

    expect(domicile.calls).toContainEqual([
      "spawn",
      [
        "sh",
        "-c",
        'case $1 in /*) exec "$EDITOR" "$1" ;; *) exec "$EDITOR" "$HOME/$1" ;; esac',
        "domicile-launcher",
        "Notes/today.org",
      ],
    ]);
    expect(launcherBox()).toBeNull();
  });

  it("opens a typed URL in a browser window on the desktop", async () => {
    const { container } = renderShell();
    press("space");
    homeHolds("todo.txt");

    await typeIntoLauncher("example.com{Enter}");

    expect(browsing(container)).toStrictEqual(["https://example.com"]);
    expect(launcherBox()).toBeNull();
  });

  it("searches for a query that is neither a file nor a URL", async () => {
    const { container } = renderShell();
    press("space");

    await typeIntoLauncher("!wiki mesa{Enter}");

    // The address the window went to is what says where the query was sent,
    // engine and escaping and all.
    expect(browsing(container)).toStrictEqual([
      "https://en.wikipedia.org/wiki/Special:Search?search=mesa",
    ]);
  });

  it("answers the same key handed back by the host", () => {
    // A browser window has the keyboard, so `mod+space` never reaches this
    // document. The launcher is the one thing on the desktop you most want to
    // reach from inside a window, so this is the path that matters for it.
    renderShell();

    hostPress("space");

    expect(launcherBox()).toBeVisible();
  });
});
