import { beforeEach, describe, expect, it } from "bun:test";
import { standaloneThemeSource } from "@domicile-desktop/component-library/standalone-theme-source";
import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { DomicileDisplay } from "@domicile-desktop/sdk/domicile-host";
import type { ShellConfigMessage } from "@domicile-desktop/sdk/host-message";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_NEW_WINDOW_EVENT,
  WEBVIEW_POPUP_WINDOW_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { DEFAULT_KEYBINDINGS, DEFAULT_MODES } from "./keyboard/commands";
import { Shell } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { BarClock, BarLauncher, BarWorkspaces } from "./top-bar/bar-items";
import type { TopBarLayout } from "./top-bar/layout";
import { laptop } from "./volume/fixture";
import { TITLE_BAR } from "./window-management/rect";
import {
  movingStyles,
  settlingStyles,
} from "./window-management/window-styles";

// The desktop as the *engine* describes it: a corner and an extent as four
// numbers, which `screens/host-displays.ts` is what regroups into the rectangle
// the component library lays out against. The double below holds this shape
// rather than that one, so the mapping is exercised by every render here.
//
// Both lie down: two monitors of one page.
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

const RIGHT: DomicileDisplay = {
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

/** Where the open dialog is laid out: the left edge and width of its box. */
const dialogBox = (): { left: string; width: string } => {
  const viewport = screen.getByRole("dialog").parentElement;
  return {
    left: viewport?.style.left ?? "",
    width: viewport?.style.width ?? "",
  };
};

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

  /** What the host's index holds, or `undefined` until a test says. */
  #home: readonly string[] | undefined;
  /** Searches the host has not answered yet. */
  readonly #asked: { query: string; settle: (found: unknown) => void }[] = [];

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

  spawn(command: readonly string[]): void {
    this.calls.push(["spawn", command]);
  }
  /**
   * The host's search, answered once {@link holds} has said what the home is —
   * and never before, which is a desktop whose walk has told it nothing yet.
   */
  searchFiles(query: string): Promise<unknown> {
    this.calls.push(["searchFiles", query]);
    return new Promise((settle) => {
      this.#asked.push({ query, settle });
      this.#answer();
    });
  }

  /** The host's search for applications, which these tests never need answered. */
  searchApps(query: string): Promise<unknown> {
    this.calls.push(["searchApps", query]);
    return new Promise(() => undefined);
  }

  /** The host's preview, which these tests never need answered. */
  previewFile(path: string): Promise<unknown> {
    this.calls.push(["previewFile", path]);
    return new Promise(() => undefined);
  }

  /** The home the host searches, which settles every search still waiting. */
  async holds(files: readonly string[]): Promise<void> {
    this.#home = files;
    await act(async () => {
      this.#answer();
      await Promise.resolve();
    });
  }

  #answer(): void {
    const home = this.#home;
    if (home !== undefined) {
      for (const { query, settle } of this.#asked.splice(0)) {
        const files = home.filter((path) => path.includes(query));
        settle({ files, indexing: false, matched: files.length, query });
      }
    }
  }
  copyClipboardEntry(entry: number): void {
    this.calls.push(["copyClipboardEntry", entry]);
  }
  grabShortcut(shortcut: unknown): void {
    this.calls.push(["grabShortcut", shortcut]);
  }
  focusApp(appId: string): void {
    this.calls.push(["focusApp", appId]);
  }
  warpPointer(to: readonly number[]): void {
    this.calls.push(["warpPointer", to]);
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
  // No popup here is clicked, so every client is its own window.
  windowOf(appId: string): string {
    return appId;
  }
  closeApp(appId: string): void {
    this.calls.push(["closeApp", appId]);
  }
  activateExtension(id: string): void {
    this.calls.push(["activateExtension", id]);
  }

  activateTrayItem(id: string, action: string): void {
    this.calls.push(["activateTrayItem", id, action]);
  }
  dismissNotifications(ids: readonly number[]): void {
    this.calls.push(["dismissNotifications", ids]);
  }
  invokeNotificationAction(id: number, action: string): void {
    this.calls.push(["invokeNotificationAction", id, action]);
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
const renderingShell = (
  desktop: readonly DomicileDisplay[] | undefined,
  topBar?: TopBarLayout,
  keybindings: ShellKeybindings = MANGANESE_KEYS,
  config: ShellConfigMessage = KEYBOARD,
) => {
  domicile = new FakeDomicile();
  domicile.displays = desktop;
  const client = domicile as unknown as DomicileClient;
  registerElements(client);
  // A standalone theme source rather than `hostTheme`: what the bar's toggle
  // does with the compositor is `host-theme.test.ts`'s, and a double that had
  // to answer `theme` as well would make every test here depend on it.
  const rendered = render(
    <Shell
      displays={hostDisplays(client)}
      domicile={client}
      keybindings={keybindings}
      theme={standaloneThemeSource()}
      topBar={topBar}
    />,
  );
  // The keyboard the keys are resolved on, which the compositor sends as the
  // page connects.
  domicile.emit("shell_config", config);
  return rendered;
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
 * The keys these tests press: the `KeyboardEvent.code` of the key each keysym
 * is on under Programmer's Dvorak — the layout the sample config in the README
 * is written for — and that key's evdev code, which is what the compositor
 * resolves a keysym to and what a binding names.
 *
 * Written out rather than read off the SDK's table: what this checks is that
 * the shell answers the key the compositor resolved, so taking the number from
 * the table the SDK reads would check nothing.
 */
const KEYS: Readonly<Record<string, readonly [code: string, keycode: number]>> =
  {
    a: ["KeyA", 30],
    asterisk: ["Digit7", 8],
    b: ["KeyN", 49],
    braceleft: ["Digit3", 4],
    braceright: ["Digit4", 5],
    bracketleft: ["Digit2", 3],
    bracketright: ["Digit0", 11],
    Down: ["ArrowDown", 108],
    d: ["KeyH", 35],
    Escape: ["Escape", 1],
    e: ["KeyD", 32],
    equal: ["Digit6", 7],
    exclam: ["Minus", 12],
    f: ["KeyY", 21],
    h: ["KeyJ", 36],
    j: ["KeyC", 46],
    k: ["KeyV", 47],
    Left: ["ArrowLeft", 105],
    l: ["KeyP", 25],
    minus: ["Quote", 40],
    parenleft: ["Digit5", 6],
    parenright: ["Digit8", 9],
    plus: ["Digit9", 10],
    q: ["KeyX", 45],
    Return: ["Enter", 28],
    Right: ["ArrowRight", 106],
    r: ["KeyO", 24],
    s: ["Semicolon", 39],
    space: ["Space", 57],
    Tab: ["Tab", 15],
    Up: ["ArrowUp", 103],
    v: ["Period", 52],
    w: ["Comma", 51],
  };

/** The key a keysym is on, or a throw for one these tests never wrote down. */
const keyOf = (keysym: string): readonly [code: string, keycode: number] => {
  const key = KEYS[keysym];
  if (key === undefined) {
    throw new Error(`test: no key written down for ${keysym}`);
  } else {
    return key;
  }
};

/**
 * One binding, as the README's sample writes it: Meta, Shift if `shift`, the
 * keysym, and the action in the config's old words.
 */
const line = (
  keysym: string,
  shift: boolean,
  action: string,
): readonly [chord: string, action: KeyAction] => {
  const [verb = "", ...rest] = action.split(" ");
  return [
    `Meta+${shift ? "Shift+" : ""}${keysym}`,
    verb === "mode"
      ? KeyAction.Mode(rest.join(" "))
      : KeyAction.SendShell(rest),
  ];
};

const DIRECTIONS = [
  ["h", "left"],
  ["j", "down"],
  ["k", "up"],
  ["l", "right"],
  ["Left", "left"],
  ["Down", "down"],
  ["Up", "up"],
  ["Right", "right"],
] as const;

const WORKSPACE_KEYS = [
  "parenleft",
  "parenright",
  "braceright",
  "plus",
  "braceleft",
  "bracketright",
  "bracketleft",
  "exclam",
  "equal",
  "asterisk",
] as const;

/**
 * The README's sample config, as the SDK delivers it once the compositor has
 * resolved every keysym: the bindings manganese shipped hard-coded before they
 * moved into the config.
 */
const MANGANESE_KEYS: ShellKeybindings = {
  keybindings: Object.fromEntries([
    line("Return", false, "send-shell terminal"),
    line("q", true, "send-shell kill"),
    line("Return", true, "send-shell lock"),
    line("space", false, "send-shell launcher"),
    line("d", false, "send-shell launcher"),
    ...DIRECTIONS.map(([keysym, way]) =>
      line(keysym, false, `send-shell focus ${way}`),
    ),
    ...DIRECTIONS.map(([keysym, way]) =>
      line(keysym, true, `send-shell move ${way}`),
    ),
    line("v", true, "send-shell clipboard"),
    line("b", false, "send-shell split h"),
    line("v", false, "send-shell split v"),
    line("s", false, "send-shell layout stacking"),
    line("w", false, "send-shell layout tabbed"),
    line("e", false, "send-shell layout toggle split"),
    line("a", false, "send-shell focus parent"),
    line("a", true, "send-shell focus child"),
    line("f", false, "send-shell fullscreen toggle"),
    line("f", true, "send-shell fullscreen toggle global"),
    line("Tab", false, "send-shell focus mode_toggle"),
    line("Tab", true, "send-shell floating toggle"),
    line("minus", false, "send-shell scratchpad show"),
    line("minus", true, "send-shell move scratchpad"),
    line("r", false, "mode resize"),
    ...WORKSPACE_KEYS.map((keysym, at) =>
      line(keysym, false, `send-shell workspace ${String(at + 1)}`),
    ),
    ...WORKSPACE_KEYS.map((keysym, at) =>
      line(
        keysym,
        true,
        `send-shell move container to workspace ${String(at + 1)}`,
      ),
    ),
  ]),
  modes: {
    resize: Object.fromEntries([
      ...DIRECTIONS.map(([keysym, way]) =>
        line(keysym, false, `send-shell resize grow ${way}`),
      ),
      line("Return", false, "mode default"),
      line("Escape", false, "mode default"),
    ]),
  },
};

/** The keyboard these tests type on: every keysym in {@link KEYS}. */
const KEYBOARD: ShellConfigMessage = {
  keys: new Map(
    Object.entries(KEYS).map(([keysym, [, keycode]]) => [keysym, keycode]),
  ),
};

/**
 * A chord pressed on this page, which is where every press the desktop's own
 * chrome or a focused Wayland window hears arrives.
 *
 * By the *key* rather than by the letter on it: a binding names the key the
 * compositor resolved its keysym to, so a test presses the key Programmer's
 * Dvorak puts `h` on, exactly as the shell reads it.
 */
const press = (keysym: string, shift = false): void => {
  fireEvent.keyDown(document, {
    code: keyOf(keysym)[0],
    metaKey: true,
    shiftKey: shift,
  });
};

/** The same chord, handed back by the host — what a focused `<webview>` does. */
const hostPress = (keysym: string, shift = false): void => {
  domicile.emit("shortcut", {
    altKey: false,
    ctrlKey: false,
    keycode: keyOf(keysym)[1],
    metaKey: true,
    shiftKey: shift,
  });
};

/** Where the page last saw the pointer, which every crossing is read against. */
const pointerAt = (x: number, y: number): void => {
  fireEvent.pointerMove(document, { clientX: x, clientY: y, pointerId: 1 });
};

/**
 * The pointer crossing into a window at a place on the page.
 *
 * The event a browser fires first when a pointer enters an element — before
 * the `pointermove` behind it — and the one the desktop reads to decide
 * whether the pointer went to the window or the window came to the pointer.
 */
const crossInto = (element: HTMLElement, x: number, y: number): void => {
  fireEvent.pointerOver(element, { clientX: x, clientY: y, pointerId: 1 });
};

/**
 * Where the shell last asked the engine to put the cursor.
 *
 * Throws where it has asked for nothing: a case that reads this is one about
 * the warp, and no warp at all is that case failing rather than passing.
 */
const warpedTo = (): readonly [x: number, y: number] => {
  const asked = [...domicile.calls]
    .reverse()
    .find(([kind]) => kind === "warpPointer");
  const to = asked?.[1];
  if (
    !Array.isArray(to) ||
    typeof to[0] !== "number" ||
    typeof to[1] !== "number"
  ) {
    throw new Error("test: the shell asked for no warp");
  } else {
    return [to[0], to[1]];
  }
};

/**
 * What the page holds down, which is what hands the shell the pointer: Meta
 * pressed, or Meta let go of when it is not held.
 */
const pageHolds = (held: { meta?: boolean; shift?: boolean }): void => {
  const meta = held.meta ?? false;
  (meta ? fireEvent.keyDown : fireEvent.keyUp)(document, {
    code: "MetaLeft",
    key: "Meta",
    metaKey: meta,
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
  ...container.querySelectorAll<HTMLElement>(
    "[data-window][aria-hidden]:not([data-border])",
  ),
];

/** The border along the right edge of a floating window: its rightmost upright strip. */
const rightBorder = (container: HTMLElement): HTMLElement => {
  const upright = [
    ...container.querySelectorAll<HTMLElement>("[data-border]"),
  ].filter(
    (border) =>
      Number.parseFloat(border.style.blockSize) >
      Number.parseFloat(border.style.inlineSize),
  );
  const [right] = upright.toSorted(
    (a, b) =>
      Number.parseFloat(b.style.insetInlineStart) -
      Number.parseFloat(a.style.insetInlineStart),
  );
  if (right === undefined) {
    throw new Error("test: no floating window's border on screen");
  } else {
    return right;
  }
};

/** The shadows cast under the floating windows on screen. */
const shadows = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-shadow]"),
];

/**
 * The shadow under the one floating window on screen.
 *
 * Throws where there is none, for the reason {@link groupOutline} does.
 */
const floatShadow = (container: HTMLElement): HTMLElement => {
  const [shadow] = shadows(container);
  if (shadow === undefined) {
    throw new Error("test: no shadow under a floating window");
  } else {
    return shadow;
  }
};

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

/**
 * The page in the first browser window on screen asking for a window of its
 * own, which is what the engine reports when a `target="_blank"` link is
 * followed: a guest cannot be handed a window the browser process made, so the
 * address arrives on the element and opening one is the desktop's.
 */
const pageAsksForAWindow = (container: HTMLElement, url: string): void => {
  const view = container.querySelector("webview");
  if (view === null) {
    throw new Error("test: no browser window for a page to ask from");
  } else {
    fireEvent(
      view,
      Object.assign(new Event(WEBVIEW_NEW_WINDOW_EVENT), { url }),
    );
  }
};

/**
 * An extension asking for a window of its own, `chrome.windows.create` with a
 * popup, which the engine dispatches on the browser window last worked in —
 * the first here, in every case that asks.
 */
const extensionAsksForAWindow = (
  container: HTMLElement,
  url: string,
  windowId: number,
): void => {
  const view = container.querySelector("webview");
  if (view === null) {
    throw new Error("test: no browser window for an extension to ask through");
  } else {
    fireEvent(
      view,
      Object.assign(new Event(WEBVIEW_POPUP_WINDOW_EVENT), {
        height: 630,
        url,
        width: 380,
        windowId,
      }),
    );
  }
};

/** The page in the first browser window on screen asking to be closed. */
const pageAsksToClose = (container: HTMLElement): void => {
  const view = container.querySelector("webview");
  if (view === null) {
    throw new Error("test: no browser window for a page to ask from");
  } else {
    fireEvent(view, new Event(WEBVIEW_CLOSE_EVENT));
  }
};

/** What every address bar on screen is showing, in the windows' own order. */
const addressesShowing = (): string[] =>
  screen
    .getAllByRole<HTMLInputElement>("combobox", { name: "Address" })
    .map((field) => field.value);

/**
 * The ring around what the commands are pointed at: the window being worked
 * in, or the container `focus parent` selected.
 *
 * Throws where there is none: every case that asks has a window open.
 */
const selectionRing = (container: HTMLElement): HTMLElement => {
  const ring = container.querySelector<HTMLElement>("[data-selection]");
  if (ring === null) {
    throw new Error("test: nothing on screen marks out the selection");
  } else {
    return ring;
  }
};

/** One of the pieces the selection ring is drawn in — see `SelectionRing`. */
const ringPart = (container: HTMLElement, part: string): HTMLElement => {
  const element = selectionRing(container).querySelector<HTMLElement>(
    `[data-part="${part}"]`,
  );
  if (element === null) {
    throw new Error(`test: the selection ring has no ${part}`);
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
 * The compositor saying what the battery is doing.
 *
 * A message like every other one here, which is the point of the change that
 * put it on this channel: the charge used to come off `navigator.getBattery`,
 * and happy-dom has no such thing — so this case needed a platform stubbed in
 * where every other one needs only the host.
 */
const machineSays = (reading: { charge: number; charging: boolean }): void => {
  domicile.emit("battery", reading);
};

/** The compositor saying what has been copied on this desktop, newest first. */
const copied = (entries: readonly { id: number; preview: string }[]): void => {
  domicile.emit("clipboard", { entries });
};

/** An extension whose click is `action.onClicked`. */
const CLICKED = "abcdefghijklmnopabcdefghijklmnop";

/** And one whose click opens its popup. */
const POPPED = "ponmlkjihgfedcbaponmlkjihgfedcba";

/**
 * The engine saying which extensions have an action: those two, the second
 * `action.disable()`d when `popped` is false.
 */
const extensionsInstalled = (popped = true): void => {
  domicile.emit("extensions", {
    extensions: [
      {
        badgeColor: "#00000000",
        badgeText: "",
        enabled: true,
        icon: "data:image/png;base64,iVBORw0KGgo=",
        id: CLICKED,
        name: "Clicked",
        popup: undefined,
        title: "Clicked",
      },
      {
        badgeColor: "#00000000",
        badgeText: "",
        enabled: popped,
        icon: "data:image/png;base64,iVBORw0KGgo=",
        id: POPPED,
        name: "Popped",
        popup: `chrome-extension://${POPPED}/popup.html`,
        title: "Popped",
      },
    ],
  });
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("Shell", () => {
  describe("across the displays", () => {
    it("gives every display a bar, and every window one element on the desk", () => {
      // A DESK OF SEVERAL MONITORS IS A DESKTOP ON EACH OF THEM, which is what
      // a second monitor is for: each has its own bar. The windows are drawn
      // once for the desk, so one that moves screens is the element it was.
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("term");

      for (const name of ["left", "right"]) {
        expect(
          screenNamed(container, name)?.querySelector("[aria-current]"),
        ).toBeInTheDocument();
      }
      expect(container.querySelectorAll("main")).toHaveLength(1);
      expect(container.querySelectorAll(APP_TAG_NAME)).toHaveLength(1);
    });

    it("shows a different workspace on each of them", () => {
      // Two screens on one workspace would be one workspace drawn twice, which
      // is one window embedded twice — and the second embedding takes the
      // first's pixels, leaving a window that answers the keyboard and draws
      // nothing. So the desk hands each screen one nobody else is on.
      const { container } = renderShell([LEFT, RIGHT]);

      const marked = (name: string) =>
        screenNamed(container, name)?.querySelector("[aria-current]")
          ?.textContent;

      expect(marked("left")).toBe("1");
      expect(marked("right")).toBe("2");
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

      expect(appElement(container, "term")).not.toHaveAttribute("hidden");
    });

    it("follows the desktop when it changes", () => {
      const { container } = renderShell([LEFT, RIGHT]);

      const stage = container.querySelector("main");
      domicile.describes([RIGHT]);

      expect(screenNamed(container, "left")).toBeNull();
      // The same stage as before the unplug, and not a new one: a chrome
      // rebuilt on a re-description reloads every embedded page to where it
      // started and re-creates every portal blank, with nothing on screen to
      // show for it. A monitor going is the commonest re-description there is.
      expect(container.querySelector("main")).toBe(stage);
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
    it("lays out the items it is given, in the columns it is given them in", () => {
      // The user's bar: an item of their own beside manganese's, and the rest
      // of manganese's left off.
      const { container } = renderingShell([LEFT], {
        left: [<BarLauncher key="launcher" />, <BarWorkspaces key="spaces" />],
        middle: [<span key="mail">mail 3/12</span>],
        right: [<BarClock key="clock" />],
      });

      const bar = container.querySelector("header");
      expect(bar).toContainElement(screen.getByText("mail 3/12"));
      expect(bar).toContainElement(
        screen.getByRole("navigation", { name: "Workspaces" }),
      );
      expect(
        screen.queryByRole("button", { name: /notification/i }),
      ).toBeNull();
    });

    it("lays out every item of manganese's when it is given none", () => {
      renderShell();

      expect(
        screen.getByRole("button", { name: "Launcher" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /notification/i }),
      ).toBeInTheDocument();
    });

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

    it("hangs a scrim below itself so the text survives a bright wallpaper", () => {
      // The shadow is a hairline under each letter; a wallpaper that is white
      // across the whole top of the screen needs the ground darkened too. The
      // scrim is deeper than the bar — a gradient that had to reach nothing by
      // the bar's own edge would be at its weakest exactly where the text is —
      // so it is a layer of its own that takes no pointer, rather than the
      // bar's background.
      const { container } = renderShell();

      expect(container.querySelector("header")?.className).toContain(
        css({
          "&::before": {
            backgroundImage: "{gradients.scrimOverPhoto}",
            content: '""',
            insetBlockEnd: -4,
            insetBlockStart: 0,
            insetInline: 0,
            pointerEvents: "none",
            position: "absolute",
            zIndex: -1,
          },
        }),
      );
    });

    it("draws no focus ring on anything in it", () => {
      const { container } = renderShell();

      expect(container.querySelector("header")?.className).toContain(
        css({ "& *": { outline: "none" } }),
      );
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

    it("shows the charge, and the plug when AC is in", () => {
      renderShell();

      machineSays({ charge: 0.42, charging: true });

      expect(screen.getByText("42%")).toBeVisible();
      expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
        "aria-valuenow",
        "42",
      );
      expect(screen.getByRole("img", { name: "Charging" })).toBeVisible();
    });

    it("shows the brightness the host says", () => {
      renderShell();

      domicile.emit("brightness", { level: 0.6 });

      expect(
        screen.getByRole("button", { name: "Brightness 60%" }),
      ).toBeVisible();
    });

    it("shows the volume the host says", () => {
      renderShell();

      domicile.emit("audio", laptop);

      expect(screen.getByRole("button", { name: "Volume 50%" })).toBeVisible();
    });

    it("draws no meter for a machine the host says nothing about", () => {
      // A desktop PC, which the compositor sends no reading for at all. The
      // bar showing `100%` on one would be the bug this readout was rebuilt
      // to stop making, wearing a different hat.
      renderShell();

      expect(screen.queryByRole("meter")).toBeNull();
    });

    it("opens the launcher from the button left of the tray", () => {
      // `mod+Space` is still the launcher's key; the button is the same
      // panel for a hand already on the pointer.
      renderShell();

      fireEvent.click(screen.getByRole("button", { name: "Launcher" }));

      expect(
        screen.getByRole("combobox", {
          name: "Open an app, a file, a URL, or search",
        }),
      ).toBeVisible();
    });

    it("has no button for the terminal: that is a key", () => {
      renderShell();

      expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull();
      expect(screen.queryByRole("button", { name: "New window" })).toBeNull();
    });

    it("carries the theme toggle", () => {
      // It changes what is already on screen rather than opening something,
      // and there is no key to press instead. Two positions and no `system` —
      // this bar is the system.
      renderShell();

      expect(
        screen.getByRole("button", { name: "Dark theme — click for light" }),
      ).toBeVisible();
      expect(screen.queryByLabelText(/system/i)).toBeNull();
    });
  });

  describe("the clipboard", () => {
    it("shows what has been copied, newest first", () => {
      // Pushed: the history is here because the compositor said so, not
      // because the panel asked on the way up.
      renderShell();
      copied([
        { id: 2, preview: "the newest" },
        { id: 1, preview: "the oldest" },
      ]);

      press("v", true);

      expect(
        screen.getAllByRole("option").map((row) => row.textContent),
      ).toStrictEqual(["the newest", "the oldest"]);
    });

    it("opens on the screen the keyboard is on", () => {
      renderShell([LEFT, RIGHT]);
      clientAppears("one");
      press("l");

      press("v", true);

      expect(dialogBox()).toStrictEqual({ left: "1920px", width: "1280px" });
    });

    it("puts the row that was picked back on the clipboard", () => {
      // By the id the compositor gave it and never by its text: what the page
      // may do to the seat's clipboard is choose among what is already on it.
      renderShell();
      copied([{ id: 7, preview: "ssh-rsa AAAA" }]);
      press("v", true);

      act(() => {
        screen.getByRole("option", { name: "ssh-rsa AAAA" }).click();
      });

      expect(domicile.calls).toContainEqual(["copyClipboardEntry", 7]);
    });
  });

  describe("the system tray", () => {
    it("is on the bar, and a click activates the icon", async () => {
      renderShell();
      domicile.emit("tray", {
        items: [
          { icon: undefined, id: ":1.9/StatusNotifierItem", title: "Sync" },
        ],
      });

      await userEvent.click(screen.getByRole("button", { name: "Sync" }));

      expect(domicile.calls).toContainEqual([
        "activateTrayItem",
        ":1.9/StatusNotifierItem",
        "primary",
      ]);
    });

    it("is left of the extensions, which are left of the workspaces", () => {
      renderShell();
      domicile.emit("tray", {
        items: [
          { icon: undefined, id: ":1.9/StatusNotifierItem", title: "Sync" },
        ],
      });
      extensionsInstalled();

      const tray = screen.getByRole("button", { name: "Sync" });
      const extension = screen.getByRole("button", { name: "Clicked" });
      const workspace = screen.getByRole("button", { name: "1" });
      expect(
        tray.compareDocumentPosition(extension) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        extension.compareDocumentPosition(workspace) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("the notifications", () => {
    /** A notification as the client hands one on. */
    const arrived = (id: number, summary: string) => ({
      actions: [],
      appName: "chat.example.com",
      body: "",
      clickable: true,
      icon: undefined,
      id,
      summary,
      time: id,
      timeoutMs: undefined,
      urgency: "normal",
    });

    it("toasts what arrives, and the bell counts it", async () => {
      renderShell();
      domicile.emit("notifications", { items: [] });

      domicile.emit("notifications", { items: [arrived(7, "New message")] });

      expect(
        await screen.findByRole("button", { name: "New message" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Notifications, 1 unread" }),
      ).toBeVisible();
    });

    it("lists them in the drawer the bell opens, and clears them all", async () => {
      renderShell();
      domicile.emit("notifications", {
        items: [arrived(1, "Older"), arrived(2, "Newer")],
      });

      await userEvent.click(
        screen.getByRole("button", { name: "Notifications" }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Clear all" }),
      );

      expect(domicile.calls).toContainEqual(["dismissNotifications", [2, 1]]);
    });

    it("opens the drawer on the screen whose bell was pressed", async () => {
      const { container } = renderShell([LEFT, RIGHT]);
      const left = screenNamed(container, "left") as HTMLElement;

      await userEvent.click(
        within(left).getByRole("button", { name: "Notifications" }),
      );

      expect(dialogBox()).toStrictEqual({ left: "0px", width: "1920px" });
    });

    it("is the far end of the bar", () => {
      renderShell();

      const battery = screen.getByRole("button", { name: /theme/ });
      const bell = screen.getByRole("button", { name: "Notifications" });
      expect(
        battery.compareDocumentPosition(bell) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("the extension tray", () => {
    it("is on the bar, and a click on one with no popup activates it", async () => {
      renderShell();
      extensionsInstalled();

      await userEvent.click(screen.getByRole("button", { name: "Clicked" }));

      expect(domicile.calls).toContainEqual(["activateExtension", CLICKED]);
    });

    it("takes the keyboard off the window while a popup is up, and gives it back", async () => {
      // A popup is a page to type into that no client knows about, the
      // launcher's case — see `AppWindow`.
      renderShell();
      extensionsInstalled();
      clientAppears("one");
      domicile.emit("focus_changed", { app_id: "one" });
      domicile.calls.length = 0;

      await userEvent.click(screen.getByRole("button", { name: "Popped" }));

      expect(domicile.calls).toContainEqual(["focusChrome"]);

      domicile.emit("focus_changed", { app_id: undefined });
      domicile.calls.length = 0;
      await userEvent.keyboard("{Escape}");

      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
    });

    it("forgets a popup whose action was disabled while it was open", async () => {
      // Its panel went with it, so an `action.enable()` later is not a click:
      // the popup stays shut until the icon is pressed again.
      const { container } = renderShell();
      extensionsInstalled();
      await userEvent.click(screen.getByRole("button", { name: "Popped" }));
      await waitFor(() => {
        expect(container.ownerDocument.querySelector("webview")).not.toBeNull();
      });

      extensionsInstalled(false);
      extensionsInstalled(true);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Popped" })).toBeVisible();
      });
      expect(container.ownerDocument.querySelector("webview")).toBeNull();
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

    it("draws a client's menu over its window, and takes it down when it goes", () => {
      // The workspace starts under the top bar, and a lone window's contents
      // start under its own title bar.
      const { container } = renderShell();
      clientAppears("term");
      const window = boxOf(appElement(container, "term"));

      domicile.emit("popup_placed", {
        app_id: "menu",
        grab: true,
        parent: "term",
        position: [12, 30],
        size: [180, 240],
      });

      const menu = appElement(container, "menu");
      expect(boxOf(menu)).toMatchObject({
        height: "240px",
        width: "180px",
        x: `${(Number.parseFloat(window.x) + 12).toString()}px`,
        y: `${(Number.parseFloat(window.y) + 30).toString()}px`,
      });
      // Over its window, not in a frame of its own.
      expect(container.querySelectorAll("[data-window]").length).toBe(
        container.querySelectorAll('[data-window="app:term"]').length,
      );

      domicile.emit("app_closed", { app_id: "menu" });
      expect(() => appElement(container, "menu")).toThrow();
      expect(appElement(container, "term")).toBeDefined();
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
      press("e");

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

    // A TAB IS NOT A WINDOW. Closing the tab a tabbed workspace is showing
    // closes it up across the strip and fades its contents, rather than
    // shrinking the whole window away over the tab taking its place.
    it("closes a closed tab up along the strip it was in", () => {
      const { container } = renderShell();
      clientAppears("term");
      clientAppears("editor");

      domicile.emit("app_closed", { app_id: "editor" });

      expect(appElement(container, "editor")).toHaveAttribute(
        "data-motion",
        "closing-tab",
      );
      expect(
        barFor(container, "app:editor").style.getPropertyValue("--collapse-x"),
      ).toBe("0");
      // Its contents only fade, to the tab taking its place under them.
      expect(
        appElement(container, "editor").style.getPropertyValue("--collapse-x"),
      ).toBe("");
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

    // AND IS DRAWN OVER THE WINDOW MOVING INTO ITS PLACE. The neighbor eases
    // into the box it had while it shrinks away inside it, and at the depth it
    // used to have the neighbor would cover it before it had gone — two
    // elements at one `z-index` are decided by the order they come in the
    // document, and a closing window goes on being drawn where it always was.
    it("draws a closing window over the one taking its space", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");

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

    // The ring is where the keyboard is, and the keyboard arrived with the
    // workspace: eased across from the window it last ringed, it crosses the
    // screen on its own while the windows slide.
    it("brings the ring on with the workspace rather than easing it across", () => {
      const { container } = renderShell();
      clientAppears("term");
      clientAppears("shell");
      press("e");
      press("braceright");
      clientAppears("editor");

      press("parenleft");

      expect(selectionRing(container).className).toContain(
        movingStyles({ motion: "arriving-from-start" }),
      );
      expect(selectionRing(container).className).toContain(
        settlingStyles({ dragging: true }),
      );
    });

    // A WORKSPACE IS A SCREENFUL, SO IT SLIDES ONE. The two are side by side
    // in the row, so the one arriving starts a whole screen over and the one
    // leaving ends a whole screen over — the keyframes read the width off the
    // window, which is its own screen's.
    it("slides a workspace the width of its screen", () => {
      const { container } = renderShell([LEFT, RIGHT]);

      pointerAt(2000, 500);
      clientAppears("term");

      expect(
        appElement(container, "term").parentElement?.style.getPropertyValue(
          "--workspace-width",
        ),
      ).toBe("1280px");
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

    // A LINK WITH `target="_blank"`, end to end. The page in a browser window
    // is a guest, so the browser process refuses the window it asks for and
    // reports the address instead — and what the user asked for is a second
    // browser window, address bar and all, which only the desktop can open.
    it("opens a second browser window when a page asks for one", async () => {
      const { container } = renderShell();
      press("space");
      await userEvent
        .setup()
        .type(screen.getByRole("combobox"), "example.com{Enter}");

      pageAsksForAWindow(container, "https://example.com/opened");

      expect(windowsOnScreen(container)).toEqual(["Browser", "Browser"]);
      expect(addressesShowing()).toContain("https://example.com/opened");
    });

    // Bitwarden's "Unlock", end to end: an extension's `chrome.windows.create`
    // is a window the engine has an id for and nothing to show it in, and the
    // desktop's answer is a browser window whose view is that window.
    it("opens the window an extension asks for, as that window", async () => {
      const { container } = renderShell();
      press("space");
      await userEvent
        .setup()
        .type(screen.getByRole("combobox"), "example.com{Enter}");

      extensionAsksForAWindow(
        container,
        "chrome-extension://vault/popup.html",
        7,
      );

      expect(windowsOnScreen(container)).toEqual(["Browser", "Browser"]);
      const popup = container.querySelector("webview[popupwindow='7']");
      expect(popup?.getAttribute("src")).toBe(
        "chrome-extension://vault/popup.html",
      );
    });

    // `window.close()` in the page, or an extension's `chrome.tabs.remove`:
    // the engine closes nothing and asks, and the window goes the way its
    // Close button takes it.
    it("closes a browser window its page asks to close", async () => {
      const { container } = renderShell();
      press("space");
      await userEvent
        .setup()
        .type(screen.getByRole("combobox"), "example.com{Enter}");

      pageAsksToClose(container);
      motionsPlayOut(container);

      expect(windowsOnScreen(container)).toEqual([]);
    });
  });

  describe("which window has the keyboard", () => {
    it("marks the focused window's bar and leaves the others resting", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(barFor(container, "app:two").dataset.focus).toBe("focused");
      expect(barFor(container, "app:one").dataset.focus).toBe("resting");
    });

    it("moves the mark with the focus", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("h");

      expect(barFor(container, "app:one").dataset.focus).toBe("focused");
      expect(barFor(container, "app:two").dataset.focus).toBe("resting");
    });

    it("moves the keyboard to a window whose bar the pointer crosses into", () => {
      // Focus follows the cursor over the whole window, and the bar is part of
      // it: crossing onto a bar on the way to the window below it is already
      // arriving there.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      pointerAt(1440, 800);

      crossInto(barFor(container, "app:one"), 300, TOP_BAR + 10);

      expect(barFor(container, "app:one").dataset.focus).toBe("focused");
    });

    it("moves the keyboard to a browser window whose page the pointer crosses into", async () => {
      // The same rule as a client's window: the page is a guest, and what the
      // shell hears is the pointer arriving over the element that holds it.
      const { container } = renderShell();
      press("space");
      await userEvent
        .setup()
        .type(screen.getByRole("combobox"), "example.com{Enter}");
      clientAppears("one");
      press("e");
      pointerAt(1440, 800);
      const view = container.querySelector<HTMLElement>("webview");
      if (view === null) {
        throw new Error("test: no browser window");
      }

      crossInto(view, 300, 500);

      expect(titleBars(container).map((bar) => bar.dataset.focus)).toEqual([
        "focused",
        "resting",
      ]);
    });

    it("draws the focused window's own frame in the accent as well", () => {
      // The bar is one edge of the window; a frame that stayed the resting
      // color would say something different from the bar above it.
      // Declarations rather than class names, because Panda hashes them.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");

      expect(appElement(container, "two").className).toContain(
        css({ borderColor: "accent" }),
      );
      expect(appElement(container, "one").className).toContain(
        css({ borderColor: "borderStrong" }),
      );
    });

    it("draws no frame in the accent around the desk's only tab group", () => {
      // Nothing else on the desk for it to be picked out from.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(appElement(container, "two").className).toContain(
        css({ borderColor: "borderStrong" }),
      );
      // Nor its focused tab's edge, which is the top of that frame.
      expect(
        titleBars(container).some((bar) =>
          bar.className.includes(css({ borderColor: "accent" })),
        ),
      ).toBe(false);
    });

    it("draws no edge in the accent on the desk's only window's bar", () => {
      const { container } = renderShell();
      clientAppears("one");

      expect(barFor(container, "app:one").className).not.toContain(
        css({ borderColor: "accent" }),
      );
    });

    it("rings a screen's only window while another screen shows one too", () => {
      // Alone on its screen but not on the desk: the window on the next screen
      // is something else the commands could be pointed at.
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("one");
      clientAppears("two");
      press("parenright", true);

      expect(selectionRing(container).dataset.selection).toBe("window");
      expect(appElement(container, "one").className).toContain(
        css({ borderColor: "accent" }),
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
          keycode: keyOf("Return")[1],
          metaKey: true,
          shiftKey: false,
        },
      ]);
    });

    it("binds sway's keys when it is given none", () => {
      // Every keysym the defaults name, on a key of its own.
      const keysyms = [DEFAULT_KEYBINDINGS, ...Object.values(DEFAULT_MODES)]
        .flatMap(Object.keys)
        .map((chord) => chord.split("+").at(-1) ?? "");
      const keys = new Map(
        [...new Set(keysyms)].map((keysym, at) => [keysym, 100 + at] as const),
      );
      renderingShell(
        [LEFT],
        undefined,
        { keybindings: DEFAULT_KEYBINDINGS, modes: DEFAULT_MODES },
        { keys },
      );

      domicile.emit("shortcut", {
        altKey: false,
        ctrlKey: false,
        keycode: keys.get("Return") ?? 0,
        metaKey: true,
        shiftKey: false,
      });

      expect(domicile.calls).toContainEqual(["spawn", ["kitty"]]);
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
      press("e");

      press("h", true);

      expect(boxOf(appElement(container, "two"))).toMatchObject({ x: "0px" });
      expect(boxOf(appElement(container, "one"))).toMatchObject({ x: "970px" });
    });

    it("makes one group of a split window and a window moved into it", () => {
      // The whole of what a split is for: `mod+v` wraps the window being
      // worked in in a column of one, and the window moved at that column
      // from beside it joins it rather than trading places with it.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("v");
      press("h");
      press("l", true);

      // One column of two, each the width of the workspace — not two windows
      // side by side, which is what a swap would have left.
      expect(boxOf(appElement(container, "one"))).toMatchObject({
        width: "1920px",
        y: `${(TOP_BAR + TITLE_BAR).toString()}px`,
      });
      expect(boxOf(appElement(container, "two"))).toMatchObject({
        width: "1920px",
        y: `${(TOP_BAR + 514 + 20 + TITLE_BAR).toString()}px`,
      });
    });

    it("lays the container out in tabs, which are the windows' own bars", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("w");

      // One tab each across the top, and the focused window's contents under
      // them — over the other's, which is drawn in the same box beneath it so
      // that it is already on screen when its tab is.
      expect(boxOf(barFor(container, "app:one"))).toMatchObject({
        width: "958px",
        x: "0px",
      });
      expect(boxOf(appElement(container, "one"))).toEqual(
        boxOf(appElement(container, "two")),
      );
      expect(Number(appElement(container, "one").style.zIndex)).toBeLessThan(
        Number(appElement(container, "two").style.zIndex),
      );
    });

    it("grows the ring out to the group `focus parent` selects, and back", () => {
      // The whole of what `mod+a` does on screen. What it points the commands
      // at is the container around the focus rather than the window in it, and
      // nothing else on the desktop says which container that is.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      const ring = selectionRing(container);
      const around = boxOf(ring);

      expect(ring.dataset.selection).toBe("window");
      press("a");

      // The same element, so it eases from one box to the other rather than
      // one line vanishing as another appears. The container holding both
      // windows is the whole workspace under the top bar.
      expect(selectionRing(container)).toBe(ring);
      expect(ring.dataset.selection).toBe("group");
      expect(boxOf(ring)).toEqual({
        height: `${(1080 - TOP_BAR).toString()}px`,
        width: "1920px",
        x: "0px",
        y: `${TOP_BAR.toString()}px`,
      });
      // And `mod+Shift+a` points them back at the window.
      press("a", true);
      expect(selectionRing(container)).toBe(ring);
      expect(boxOf(ring)).toEqual(around);
    });

    it("rounds the ring at all four corners, as a window's frame is", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");

      for (const corner of [
        css({ borderStartStartRadius: "lg" }),
        css({ borderStartEndRadius: "lg" }),
      ]) {
        expect(ringPart(container, "tab").className).toContain(corner);
      }
      for (const corner of [
        css({ borderEndStartRadius: "lg" }),
        css({ borderEndEndRadius: "lg" }),
      ]) {
        expect(ringPart(container, "body").className).toContain(corner);
      }
    });

    it("rises around the open tab alone, and runs under the ones beside it", () => {
      // A ring around the whole of a tabbed container is drawn across every
      // tab, and says nothing about which of them is open.
      // Beside a window of its own, or the tabs would be all the screen shows.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      press("v");
      clientAppears("three");

      press("w");

      // The second of two tabs, in the ring's own coordinates.
      expect(boxOf(ringPart(container, "tab"))).toMatchObject({
        width: "473px",
        x: "477px",
      });
      expect(boxOf(ringPart(container, "before"))).toMatchObject({
        width: "477px",
      });
      expect(boxOf(ringPart(container, "after"))).toMatchObject({
        width: "0px",
      });
    });

    it("runs the open tab's edge under the tabs beside it", () => {
      // Beside a window of its own, or the tabs would be all the screen shows.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      press("v");
      clientAppears("three");

      press("w");

      expect(barFor(container, "app:two").className).toContain(
        css({ borderBlockEndColor: "accent" }),
      );
      expect(barFor(container, "app:three").className).not.toContain(
        css({ borderBlockEndColor: "accent" }),
      );
    });

    it("slides the ring across to a window that has just opened", () => {
      // The ring is where the keyboard is, and the eye follows it there from
      // the last window rather than hunting for where it reappeared.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      motionsPlayOut(container);
      clientAppears("three");
      const ring = selectionRing(container);

      expect(ring.className).toContain(settlingStyles({ dragging: false }));
      expect(ring.className).not.toContain(movingStyles({ motion: "opening" }));
    });

    it("grows the ring in with the window that brings it on", () => {
      // A window alone on the screen has no ring, so there is no last one to
      // slide across from, and a ring drawn at full size around a window still
      // growing in is a line ahead of it.
      const { container } = renderShell();
      clientAppears("one");
      press("e");
      clientAppears("two");

      expect(selectionRing(container).className).toContain(
        movingStyles({ motion: "opening" }),
      );
    });

    it("keeps the group when the layout slides a window under the pointer", () => {
      // What moving a group looks like from the desktop's side: the windows
      // trade places under a hand that has not moved, and the `pointerover`
      // one fires as it arrives carries the spot the pointer is already at.
      // Answering that one handed the keyboard — and with it the selection —
      // to whichever window the layout happened to slide past.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("v");
      clientAppears("three");
      pointerAt(1440, 800);

      press("a");
      press("h", true);

      crossInto(appElement(container, "one"), 1440, 800);
      expect(selectionRing(container).dataset.selection).toBe("group");
    });

    it("knows its own warp, at a place that is not a whole pixel", () => {
      // Three windows divide the workspace into thirds that are not whole
      // pixels, so the middle of one is a fraction — and the engine puts the
      // cursor on the pixel beside it (`base::ClampRound`). A page that asked
      // for the fraction does not recognize its own warp arriving, and reads
      // the window the cursor came down on as one the user pointed at, in the
      // middle of the layout easing past.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      clientAppears("three");
      press("e");
      press("h");
      press("h");
      press("v");
      pointerAt(1700, 900);

      // The group, moved along the row until it is the third of three.
      press("a");
      press("l", true);
      press("l", true);

      // The engine puts the cursor down on a whole pixel whatever it was
      // asked for, and the window it lands on says so — here the one the
      // group was moved past, which does not hold the keyboard, so nothing
      // but this rule stands between the crossing and the selection.
      const [x, y] = warpedTo();
      crossInto(appElement(container, "two"), Math.round(x), Math.round(y));

      expect(selectionRing(container).dataset.selection).toBe("group");
    });

    it("and hands it over to a pointer that really crossed into one", () => {
      // The other half of the same rule, and the half that keeps focus
      // following the cursor: a crossing at a place the pointer was not is
      // the user choosing a window, and choosing one outside the group is
      // choosing to leave it. The crossing says so on its own — a browser
      // fires it *before* the move behind it, so a desktop that waited for
      // the move would swallow the window the user had just reached for.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      press("v");
      clientAppears("three");
      pointerAt(1440, 800);

      press("a");
      press("h", true);

      crossInto(appElement(container, "one"), 300, 500);
      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
      expect(selectionRing(container).dataset.selection).toBe("window");
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

    it("squares the corners of the window filling the screen", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("f");

      expect(appElement(container, "term").className).not.toContain(
        css({ borderEndEndRadius: "lg" }),
      );
      expect(barFor(container, "app:term").className).not.toContain(
        css({ borderStartStartRadius: "lg" }),
      );
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

    it("floats a window no smaller than its client will draw", () => {
      // Wider than the 1280 a float opens at, and shorter than its 770: the
      // client's frame would be cut off across and stretched down.
      const { container } = renderShell();
      clientAppears("vault");
      domicile.emit("app_min_size", { app_id: "vault", size: [1300, 300] });
      domicile.emit("app_max_size", { app_id: "vault", size: [1400, 350] });

      press("Tab", true);

      expect(boxOf(appElement(container, "vault"))).toMatchObject({
        height: "350px",
        width: "1300px",
      });
    });

    it("keeps a window's bar across floating it and back", () => {
      // The window under it is the same element either way and eases to its
      // new box; a bar made anew would jump there and leave the window behind.
      const { container } = renderShell();
      clientAppears("term");
      const tiled = barFor(container, "app:term");

      press("Tab", true);
      expect(barFor(container, "app:term")).toBe(tiled);

      press("Tab", true);
      expect(barFor(container, "app:term")).toBe(tiled);
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

    it("takes the sheet down when Meta comes up", () => {
      // Chromium on Wayland reports the release of Meta with `metaKey` still
      // set — the state from before the key came up — so the flag alone
      // leaves the modifier held for good.
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      fireEvent.keyUp(document, {
        code: "MetaLeft",
        key: "Meta",
        metaKey: true,
      });

      expect(grabSheets(container)).toHaveLength(0);
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

    it("resizes a floating window by its edge, with no modifier held", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);
      pageHolds({});
      const was = Number.parseFloat(
        barFor(container, "app:term").style.inlineSize,
      );

      fireEvent.pointerDown(rightBorder(container), {
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
      fireEvent.pointerUp(window, { clientX: 140, clientY: 130 });

      expect(
        Number.parseFloat(barFor(container, "app:term").style.inlineSize),
      ).toBe(was + 40);
    });

    it("keeps the ring on a float being dragged rather than easing after it", () => {
      // The ring eases between boxes, which is right for `focus parent` and a
      // retile — and a ring trailing every step of a drag behind the window.
      const { container } = renderShell();
      clientAppears("shell");
      clientAppears("term");
      press("Tab", true);
      const bar = barFor(container, "app:term");

      fireEvent.pointerDown(bar, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 100 });

      expect(selectionRing(container).className).toContain(
        settlingStyles({ dragging: true }),
      );
    });

    it("drags a floating window onto the next screen and keeps hold of it", () => {
      // The screen its middle is over takes it, and the drag goes on after its
      // bar has gone from the screen that was pressed.
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("term");
      press("Tab", true);
      const was = Number.parseFloat(
        barFor(container, "app:term").style.insetInlineStart,
      );

      fireEvent.pointerDown(barFor(container, "app:term"), {
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, {
        clientX: 100 + LEFT.width,
        clientY: 100,
      });
      fireEvent.pointerMove(window, {
        clientX: 110 + LEFT.width,
        clientY: 100,
      });
      fireEvent.pointerUp(window, { clientX: 110 + LEFT.width, clientY: 100 });

      expect(
        Number.parseFloat(barFor(container, "app:term").style.insetInlineStart),
      ).toBe(was + LEFT.width + 10);
    });

    it("drags a browser window onto the next screen without loading its page again", async () => {
      // One `<webview>` for the window wherever it is: another would be a new
      // guest, and the page in it loaded from scratch.
      const { container } = renderShell([LEFT, RIGHT]);
      press("space");
      await userEvent
        .setup()
        .type(screen.getByRole("combobox"), "example.com{Enter}");
      press("Tab", true);
      const view = container.querySelector("webview");

      fireEvent.pointerDown(barFor(container, "browser:1"), {
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, {
        clientX: 100 + LEFT.width,
        clientY: 100,
      });
      fireEvent.pointerUp(window, { clientX: 100 + LEFT.width, clientY: 100 });

      expect(container.querySelectorAll("webview")).toHaveLength(1);
      expect(container.querySelector("webview")).toBe(view);
    });

    it("draws a float over the edge between two screens once, whole", () => {
      // One page spans the desk, so a float hanging over onto the next screen
      // is one element at its place on the page, over both.
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("term");
      press("Tab", true);
      const was = Number.parseFloat(
        barFor(container, "app:term").style.insetInlineStart,
      );

      fireEvent.pointerDown(barFor(container, "app:term"), {
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(window, { clientX: 1500, clientY: 100 });
      fireEvent.pointerUp(window, { clientX: 1500, clientY: 100 });

      expect(
        container.querySelectorAll(`${APP_TAG_NAME}:not([hidden])`),
      ).toHaveLength(1);
      expect(
        Number.parseFloat(barFor(container, "app:term").style.insetInlineStart),
      ).toBe(was + 1400);
    });

    it("draws a fullscreen float's bar at the top of the screen", async () => {
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      await user.click(screen.getByRole("button", { name: "Maximize" }));

      expect(boxOf(barFor(container, "app:term"))).toMatchObject({
        width: "1920px",
        x: "0px",
        y: "0px",
      });
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

    it("casts a shadow under a floating window and not under a tiled one", () => {
      const { container } = renderShell();
      clientAppears("term");
      expect(shadows(container)).toHaveLength(0);

      press("Tab", true);

      // Around the whole frame — the bar and the contents under it — at the
      // window's own depth, and before the window in the document, so the
      // window paints over its own shadow and over nothing else's.
      const shadow = floatShadow(container);
      const app = appElement(container, "term");
      const bar = barFor(container, "app:term");
      const top = Number.parseFloat(bar.style.insetBlockStart);
      const bottom =
        Number.parseFloat(app.style.insetBlockStart) +
        Number.parseFloat(app.style.blockSize);
      expect(boxOf(shadow)).toEqual({
        height: `${(bottom - top).toString()}px`,
        width: app.style.inlineSize,
        x: app.style.insetInlineStart,
        y: bar.style.insetBlockStart,
      });
      expect(shadow.style.zIndex).toBe(app.style.zIndex);
      expect(shadow.compareDocumentPosition(app)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      press("Tab", true);
      expect(shadows(container)).toHaveLength(0);
    });

    it("rounds its shadow at all four corners, as the frame is", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      expect(floatShadow(container).className).toContain(
        css({ borderRadius: "lg" }),
      );
    });

    it("casts no shadow from a float that fills the screen", () => {
      // Its shadow would fall off the edge of the screen — onto the next
      // display, on a desk of more than one.
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      press("f");

      expect(shadows(container)).toHaveLength(0);
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
    it("shuffles a float pressed on over the one covering it", () => {
      // The two part, trade depths while apart and come back together — every
      // part of each window with it, and the ring around the one pressed on.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("Tab", true);
      press("Tab");
      press("Tab", true);
      motionsPlayOut(container);
      const under = appElement(container, "two");
      expect(Number(under.style.zIndex)).toBeLessThan(
        Number(appElement(container, "one").style.zIndex),
      );

      fireEvent.pointerDown(barFor(container, "app:two"), {
        clientX: 100,
        clientY: 100,
      });

      const raised = [
        appElement(container, "two"),
        barFor(container, "app:two"),
        selectionRing(container),
      ];
      const covered = [
        appElement(container, "one"),
        barFor(container, "app:one"),
      ];
      for (const element of [...raised, ...covered]) {
        expect(element.style.getPropertyValue("--restack-x")).not.toBe("");
      }
      expect(
        movingParts(container, "restacking").filter(
          (element) => element.dataset.shadow === undefined,
        ),
      ).toEqual([
        appElement(container, "one"),
        barFor(container, "app:one"),
        appElement(container, "two"),
        barFor(container, "app:two"),
      ]);
      for (const element of raised) {
        expect(
          Number(element.style.getPropertyValue("--restack-to")),
        ).toBeGreaterThan(
          Number(element.style.getPropertyValue("--restack-from")),
        );
      }
      expect(
        [...shadows(container)].map((shadow) =>
          shadow.style.getPropertyValue("--restack-x"),
        ),
      ).not.toContain("");
    });

    it("starts the ring's shuffle over with its window's", () => {
      // Pressed back and forth faster than a shuffle takes: each press is a
      // new animation, for the ring as much as for the window it rings.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("Tab", true);
      press("Tab");
      press("Tab", true);
      motionsPlayOut(container);

      for (const id of ["two", "one"]) {
        fireEvent.pointerDown(barFor(container, `app:${id}`), {
          clientX: 100,
          clientY: 100,
        });
        fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
      }

      expect(appElement(container, "one").dataset.motion).toBe(
        "restacking-again",
      );
      expect(selectionRing(container).className).toContain(
        movingStyles({ motion: "restacking-again" }),
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
    it("takes the pointer to a window that has just opened", () => {
      // Nobody pressed a key for this one: the client finished starting and
      // its window took the keyboard. The pointer is wherever it was — over
      // the window that was there before, in a real session — and the first
      // pointer event over that window would take the focus straight back.
      const { container } = renderShell();
      clientAppears("one");
      press("b");
      domicile.calls.length = 0;

      clientAppears("two");

      expect(domicile.calls).toContainEqual(["warpPointer", [1445, 571]]);
      expect(boxOf(appElement(container, "two"))).toMatchObject({
        height: "1018px",
        width: "950px",
        x: "970px",
        y: "62px",
      });
    });

    it("takes the pointer with it when a key moves the focus", () => {
      // `mouse_warping`, and the reason this desktop needs it: the window the
      // focus came from is still under the pointer, and the first pointer
      // event over it would hand the focus straight back. The pointer goes to
      // the middle of the window's contents — 950 wide from the left edge,
      // under its own title bar — which is the region a `pointerover` on
      // focuses.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      domicile.calls.length = 0;

      press("h");

      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
      expect(domicile.calls).toContainEqual(["warpPointer", [475, 571]]);
      expect(boxOf(appElement(container, "one"))).toMatchObject({
        height: "1018px",
        width: "950px",
        x: "0px",
        y: "62px",
      });
    });

    it("takes the pointer to the middle of an empty screen a key moved to", () => {
      // sway's `focus right` onto an output with nothing on it. The pointer
      // left on the screen the keyboard came from would take it straight back.
      renderShell([LEFT, RIGHT]);
      clientAppears("one");
      domicile.calls.length = 0;

      press("l");

      expect(domicile.calls).toContainEqual(["warpPointer", [2560, 512]]);
    });

    it("gives the keyboard to the window the pointer moves into", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
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

    it("moves the keyboard to the screen the pointer moves onto", () => {
      // An empty screen as much as one with a window on it, which is sway's
      // focus following the mouse from one output to the next: the next
      // window opens where the hand is.
      const { container } = renderShell([LEFT, RIGHT]);

      pointerAt(2000, 500);
      clientAppears("term");

      // Drawn there rather than only kept there.
      const term = appElement(container, "term");
      expect(term).not.toHaveAttribute("hidden");
      expect(
        Number.parseFloat(term.style.insetInlineStart),
      ).toBeGreaterThanOrEqual(RIGHT.x);
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
    screen.queryByRole("combobox", {
      name: "Open an app, a file, a URL, or search",
    });

  /** The same box where a case needs it to be there. */
  const typeIntoLauncher = async (typed: string): Promise<void> => {
    await userEvent.setup().type(
      screen.getByRole("combobox", {
        name: "Open an app, a file, a URL, or search",
      }),
      typed,
    );
  };

  /** Where each browser window on the desktop was pointed. */
  const browsing = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("webview")].map(
      (view) => view.getAttribute("src") ?? "",
    );

  /** What the host's index of the home holds, which is what fills the panel. */
  const homeHolds = (...files: readonly string[]): Promise<void> =>
    domicile.holds(files);

  it("is not on screen until the key that opens it", () => {
    renderShell();

    expect(launcherBox()).toBeNull();
  });

  it("opens on the screen the keyboard is on", () => {
    renderShell([LEFT, RIGHT]);
    clientAppears("one");
    press("l");

    press("space");

    expect(dialogBox()).toStrictEqual({ left: "1920px", width: "1280px" });
  });

  it("opens on mod+space and asks the host what matches its empty box", () => {
    // The ask rides with the opening rather than with the shell starting: a
    // home directory changes for reasons nothing here is watching, so the
    // answer has to be current at the moment the panel is.
    renderShell();

    press("space");

    expect(launcherBox()).toBeVisible();
    expect(domicile.calls).toContainEqual(["searchFiles", ""]);
  });

  it("asks the host for its empty box's applications before it is opened", () => {
    // Unlike the files: an answer that landed after the panel did would push
    // the rows under it down. See `launcher/useOpeningApps.ts`.
    renderShell();

    expect(domicile.calls).toContainEqual(["searchApps", ""]);

    press("space");

    expect(
      domicile.calls.filter(([call]) => call === "searchApps"),
    ).toStrictEqual([["searchApps", ""]]);
  });

  it("shows the files the host answered with", async () => {
    const { unmount } = renderShell();
    press("space");

    await homeHolds("Notes/today.org", "todo.txt");

    // A row is the name and then the directories above it — see
    // `launcher/file-row.ts` — with the grid's gap, rather than any text,
    // between the two.
    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(["Notestoday.org", "todo.txt"]);
    // Taken down here rather than by the shared `afterEach`: the highlight
    // settles into a preview on a timer, and one that comes due between this
    // test and its cleanup updates the panel outside `act`.
    unmount();
  });

  it("opens a file with the user's default application and puts the panel away", async () => {
    // `$HOME` is read by the spawned shell, because it exists there and
    // nowhere this page can see. See `launcher/open-command.ts`.
    renderShell();
    press("space");
    await homeHolds("Notes/today.org");

    await userEvent.setup().click(screen.getByRole("option"));

    expect(domicile.calls).toContainEqual([
      "spawn",
      [
        "sh",
        "-c",
        'case $1 in /*) exec xdg-open "$1" ;; *) exec xdg-open "$HOME/$1" ;; esac',
        "domicile-launcher",
        "Notes/today.org",
      ],
    ]);
    expect(launcherBox()).toBeNull();
  });

  it("opens a typed URL in a browser window on the desktop", async () => {
    const { container } = renderShell();
    press("space");
    await homeHolds("todo.txt");

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

  it("takes the keyboard off the window it is opened over", () => {
    // THE PANEL IS DRAWN BY THE PAGE AND THE KEYBOARD IS THE COMPOSITOR'S.
    // A client holding the seat goes on receiving every keystroke while the
    // launcher is up over it, so the box the user is typing into fills with
    // nothing and the window underneath takes the letters — which is a
    // launcher that opens and then cannot be used.
    renderShell();
    clientAppears("one");
    domicile.emit("focus_changed", { app_id: "one" });
    domicile.calls.length = 0;

    press("space");

    expect(domicile.calls).toContainEqual(["focusChrome"]);
  });

  it("hands the keyboard back to the window when it is put away", () => {
    // The other half, and the one that makes taking it safe: the seat is the
    // window's again the moment the panel is down, without waiting for the
    // pointer to cross it.
    renderShell();
    clientAppears("one");
    domicile.emit("focus_changed", { app_id: "one" });
    press("space");
    // The compositor carrying out the request above, which is how the shell
    // learns the seat has moved.
    domicile.emit("focus_changed", { app_id: undefined });
    domicile.calls.length = 0;

    press("space");

    expect(domicile.calls).toContainEqual(["focusApp", "one"]);
  });

  it("keeps the box focused over a browser window", async () => {
    // A browser window's page is a guest frame, and a guest holding the
    // page's focus hears the keyboard in a browsing context this document
    // cannot: the window pulls the focus back to itself on its own, so a
    // panel over it has to be the thing that says otherwise.
    const { container } = renderShell();
    press("space");
    await typeIntoLauncher("example.com{Enter}");
    expect(container.querySelector("webview")).not.toBeNull();

    press("space");

    expect(launcherBox()).toHaveFocus();
  });

  it("leaves nothing over the desktop once a launch puts it away", async () => {
    // The panel closes as the window it opened arrives, and its backdrop has
    // to go with it: one left behind takes every click on the page.
    const { baseElement } = renderShell([LEFT]);
    press("space");

    await typeIntoLauncher("example.com{Enter}");

    await waitFor(() => {
      expect(baseElement.querySelector("[data-backdrop]")).toBeNull();
    });
  });

  it("keeps the panel up while it closes", () => {
    // The panel has to stay drawn until the dialog has finished closing: a
    // panel taken away with the press that closed it is one that never gets
    // to leave.
    renderShell();
    press("space");

    press("space");

    expect(screen.getByRole("dialog")).toHaveAttribute("data-ending-style");
  });

  it("answers the same key handed back by the host", () => {
    // A browser window has the keyboard, so `mod+space` never reaches this
    // document. The launcher is the one thing on the desktop you most want to
    // reach from inside a window, so this is the path that matters for it.
    renderShell();

    hostPress("space");

    expect(launcherBox()).toBeVisible();
  });

  it("leaves the tab that was open selected once it is dismissed", async () => {
    // The page takes the keyboard back from the client while the panel is up,
    // and the engine hands it to the guest that last had it: the browser in
    // the tab behind, which nobody can click.
    const { container } = renderShell();
    press("space");
    await typeIntoLauncher("example.com{Enter}");
    clientAppears("two");
    press("space");
    const behind = container.querySelector<HTMLElement>("webview");
    if (behind === null) {
      throw new Error("test: no browser window");
    }
    act(() => {
      behind.dispatchEvent(
        new Event(WEBVIEW_GUEST_FOCUS_EVENT, { bubbles: true }),
      );
    });

    await userEvent.setup().keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(barFor(container, "app:two").dataset.focus).toBe("focused");
  });
});
