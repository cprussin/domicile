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

// Displays in the engine's shape, so every render exercises the mapping in
// `screens/host-displays.ts`. Two landscape monitors side by side.
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

/** The top bar's height; windows start below it. */
const TOP_BAR = 32;

/** The region a `<Screen>` renders for the display of this name. */
const screenNamed = (container: HTMLElement, name: string): Element | null =>
  container.querySelector(`[data-screen="${name}"]`);

/** The open dialog's left edge and width. */
const dialogBox = (): { left: string; width: string } => {
  const viewport = screen.getByRole("dialog").parentElement;
  return {
    left: viewport?.style.left ?? "",
    width: viewport?.style.width ?? "",
  };
};

type Call = readonly [kind: string, ...args: unknown[]];

// Records the chrome's calls to the host and emits host events.
class FakeDomicile {
  readonly calls: Call[] = [];

  /** The last description, retained as the real client retains it. */
  displays: readonly DomicileDisplay[] | undefined;

  readonly #handlers = new Map<string, (message: unknown) => void>();

  /** The files the host's index holds, or `undefined` until a test sets it. */
  #home: readonly string[] | undefined;
  /** Searches not yet answered. */
  readonly #asked: { query: string; settle: (found: unknown) => void }[] = [];

  on(type: string, handler: (message: never) => void): this {
    this.#handlers.set(type, handler as (message: unknown) => void);
    return this;
  }

  // Only remove the current handler: `on` has a single slot, so removing
  // whatever is registered could drop a newer handler.
  off(type: string, handler: (message: never) => void): this {
    if (this.#handlers.get(type) === handler) {
      this.#handlers.delete(type);
    }
    return this;
  }

  /** The host describes the desktop. */
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
  /** Answered only after {@link holds} sets the index contents. */
  searchFiles(query: string): Promise<unknown> {
    this.calls.push(["searchFiles", query]);
    return new Promise((settle) => {
      this.#asked.push({ query, settle });
      this.#answer();
    });
  }

  /** Never answered; these tests do not need it. */
  searchApps(query: string): Promise<unknown> {
    this.calls.push(["searchApps", query]);
    return new Promise(() => undefined);
  }

  /** Never answered; these tests do not need it. */
  previewFile(path: string): Promise<unknown> {
    this.calls.push(["previewFile", path]);
    return new Promise(() => undefined);
  }

  /** Sets the index contents and answers every pending search. */
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
  // The portal forwards keys to the focused window, so shell keystrokes reach
  // this once a window has the keyboard.
  key(appId: string, keycode: number, pressed: boolean): void {
    this.calls.push(["key", appId, keycode, pressed]);
  }
  focusChrome(): void {
    this.calls.push(["focusChrome"]);
  }
  // These tests do not exercise pointer mapping, so every window maps its own
  // box 1:1.
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
 * Renders the chrome on `desktop`.
 *
 * The desktop is described before the first render by default, as after a
 * completed handshake. Pass `undefined` to test the gap.
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
  // A standalone theme, so these tests do not depend on the host theme
  // protocol; `host-theme.test.ts` covers that.
  const rendered = render(
    <Shell
      displays={hostDisplays(client)}
      domicile={client}
      keybindings={keybindings}
      theme={standaloneThemeSource()}
      topBar={topBar}
    />,
  );
  // The compositor sends the keyboard map on connect.
  domicile.emit("shell_config", config);
  return rendered;
};

/** The chrome on an already described desktop. */
const renderShell = (desktop: readonly DomicileDisplay[] = [LEFT]) =>
  renderingShell(desktop);

/** The chrome before any desktop is described, or with no host at all. */
const renderUndescribedShell = () => renderingShell(undefined);

/** The host announces a client, which becomes a window. */
const clientAppears = (appId: string, title = appId): void => {
  domicile.emit("app_appeared", { app_id: appId, title });
};

/**
 * The keys these tests press: each keysym's `KeyboardEvent.code` and evdev
 * keycode under Programmer's Dvorak, the README sample's layout.
 *
 * Written out rather than taken from the SDK's table, so the test checks the
 * shell against independent values.
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

/** The key for a keysym; throws for one missing from {@link KEYS}. */
const keyOf = (keysym: string): readonly [code: string, keycode: number] => {
  const key = KEYS[keysym];
  if (key === undefined) {
    throw new Error(`test: no key written down for ${keysym}`);
  } else {
    return key;
  }
};

/**
 * One binding in the README sample's form: Meta, Shift if `shift`, the
 * keysym, and the action.
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

/** The README's sample config as the SDK delivers it, keysyms resolved. */
const MANGANESE_KEYS: ShellKeybindings = {
  keybindings: Object.fromEntries([
    line("Return", false, "send-shell exec kitty"),
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

/** The keyboard map for every keysym in {@link KEYS}. */
const KEYBOARD: ShellConfigMessage = {
  keys: new Map(
    Object.entries(KEYS).map(([keysym, [, keycode]]) => [keysym, keycode]),
  ),
};

/**
 * A chord pressed on this page, where the chrome and focused Wayland windows
 * receive keys.
 *
 * Presses the physical key, not the letter: a binding names the key the
 * compositor resolved its keysym to.
 */
const press = (keysym: string, shift = false): void => {
  fireEvent.keyDown(document, {
    code: keyOf(keysym)[0],
    metaKey: true,
    shiftKey: shift,
  });
};

/** The same chord forwarded by the host, as from a focused `<webview>`. */
const hostPress = (keysym: string, shift = false): void => {
  domicile.emit("shortcut", {
    altKey: false,
    ctrlKey: false,
    keycode: keyOf(keysym)[1],
    metaKey: true,
    shiftKey: shift,
  });
};

/** Moves the pointer on the page; crossings are judged against it. */
const pointerAt = (x: number, y: number): void => {
  fireEvent.pointerMove(document, { clientX: x, clientY: y, pointerId: 1 });
};

/**
 * The pointer crossing into a window at a point on the page.
 *
 * The desktop reads this `pointerover` to tell whether the pointer moved or
 * the window moved under it.
 */
const crossInto = (element: HTMLElement, x: number, y: number): void => {
  fireEvent.pointerOver(element, { clientX: x, clientY: y, pointerId: 1 });
};

/**
 * Where the shell last warped the cursor.
 *
 * Throws if it never warped, so a missing warp fails the test.
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

/** Sets the page's held modifiers. Meta held hands the shell the pointer. */
const pageHolds = (held: { meta?: boolean; shift?: boolean }): void => {
  const meta = held.meta ?? false;
  (meta ? fireEvent.keyDown : fireEvent.keyUp)(document, {
    code: "MetaLeft",
    key: "Meta",
    metaKey: meta,
    shiftKey: held.shift ?? false,
  });
};

/** The visible windows, by app ID or window label. */
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

/** Every window's title bar, in opening order. */
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

/** The motion of every element that is arriving or leaving. */
const moving = (container: HTMLElement): string[] =>
  [
    ...container.querySelectorAll<HTMLElement>(
      '[data-motion]:not([data-motion="resting"])',
    ),
  ].map((element) => element.dataset.motion ?? "");

/** The elements in motion `motion`. */
const movingParts = (container: HTMLElement, motion: string): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>(`[data-motion="${motion}"]`),
];

/**
 * Ends every running animation.
 *
 * Test DOMs fire no `animationend`, and the shell keeps drawing closed windows
 * and left workspaces until it arrives.
 */
const motionsPlayOut = (container: HTMLElement): void => {
  for (const element of container.querySelectorAll(
    '[data-motion]:not([data-motion="resting"])',
  )) {
    fireEvent.animationEnd(element);
  }
};

/** The drag-catching sheets over floating windows. */
const grabSheets = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>(
    "[data-window][aria-hidden]:not([data-border])",
  ),
];

/** A floating window's right border: its rightmost vertical strip. */
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

/** The shadows under floating windows. */
const shadows = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-shadow]"),
];

/**
 * The shadow under the only floating window.
 *
 * Throws if there is none, like {@link groupOutline}.
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
 * The first browser window's page asks for a new window, as when a
 * `target="_blank"` link is followed. The desktop opens it.
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
 * An extension calls `chrome.windows.create` with a popup. The engine
 * dispatches it on the last used browser window, the first one here.
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

/** The first browser window's page asks to close. */
const pageAsksToClose = (container: HTMLElement): void => {
  const view = container.querySelector("webview");
  if (view === null) {
    throw new Error("test: no browser window for a page to ask from");
  } else {
    fireEvent(view, new Event(WEBVIEW_CLOSE_EVENT));
  }
};

/** Every address bar's value, in window order. */
const addressesShowing = (): string[] =>
  screen
    .getAllByRole<HTMLInputElement>("combobox", { name: "Address" })
    .map((field) => field.value);

/**
 * The scrim over window or tab `id` that dims it while commands target
 * something else; see `Scrim`.
 *
 * Throws if there is none.
 */
const scrimOver = (container: HTMLElement, id: string): HTMLElement => {
  const scrim = container.querySelector<HTMLElement>(`[data-scrim="${id}"]`);
  if (scrim === null) {
    throw new Error(`test: no scrim over ${id}`);
  } else {
    return scrim;
  }
};

/** Whether window or tab `id` is dimmed. */
const dimmed = (container: HTMLElement, id: string): boolean =>
  scrimOver(container, id).dataset.dimmed !== undefined;

/**
 * Whether `focus parent` targets a group: the focused window's bar marks
 * itself apart from the group.
 */
const pointedAtGroup = (container: HTMLElement): boolean =>
  titleBars(container).some((bar) => bar.dataset.focus === "leaf");

/** An element's laid-out box. */
const boxOf = (element: HTMLElement) => ({
  height: element.style.blockSize,
  width: element.style.inlineSize,
  x: element.style.insetInlineStart,
  y: element.style.insetBlockStart,
});

/** The compositor reports the battery state. */
const machineSays = (reading: { charge: number; charging: boolean }): void => {
  domicile.emit("battery", reading);
};

/** The compositor reports the clipboard history, newest first. */
const copied = (entries: readonly { id: number; preview: string }[]): void => {
  domicile.emit("clipboard", { entries });
};

/** An extension whose click fires `action.onClicked`. */
const CLICKED = "abcdefghijklmnopabcdefghijklmnop";

/** An extension whose click opens its popup. */
const POPPED = "ponmlkjihgfedcbaponmlkjihgfedcba";

/**
 * The engine reports both extensions' actions. The second is disabled when
 * `popped` is false.
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
      // Each monitor gets its own bar. Windows are drawn once for the desk, so
      // a window keeps its element when it changes screens.
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
      // Two screens on one workspace would embed a window twice, and the
      // second embedding takes the first's pixels. Each screen gets its own.
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
      // A reloaded chrome can learn of open clients before the handshake.
      // Rebuilding it after would blank every portal and reload every page.
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
      // The same stage: rebuilding it would reload every page and blank every
      // portal. Unplugging a monitor is the common case.
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
      // A custom item beside some of manganese's, the rest left out.
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
      // The bar has no background, so the shadow separates text from the
      // wallpaper. Checked by declarations because Panda hashes class names.
      const { container } = renderShell();

      const bar = container.querySelector("header");
      expect(bar?.className).toContain(css({ color: "white" }));
      expect(bar?.className).toContain(css({ textShadow: "textOverPhoto" }));
    });

    it("hangs a scrim below itself so the text survives a bright wallpaper", () => {
      // The text shadow alone is too thin for a bright wallpaper. The scrim
      // extends below the bar so the gradient is not weakest under the text,
      // so it is a separate layer that ignores the pointer.
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
      // As in sway's bar, an empty workspace that is not shown is omitted.
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
      // A desktop PC gets no battery reading; the bar must not show `100%`.
      renderShell();

      expect(screen.queryByRole("meter")).toBeNull();
    });

    it("opens the launcher from the button left of the tray", () => {
      // `mod+Space` also opens it; the button is for pointer users.
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
      // No key does this. Two states and no `system`, since this bar is the
      // system.
      renderShell();

      expect(
        screen.getByRole("button", { name: "Dark theme — click for light" }),
      ).toBeVisible();
      expect(screen.queryByLabelText(/system/i)).toBeNull();
    });
  });

  describe("the clipboard", () => {
    it("shows what has been copied, newest first", () => {
      // The compositor pushes the history; the panel does not ask for it.
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
      // By id, never by text: the page may only choose among entries already
      // on the seat's clipboard.
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
      // A popup is a page to type into, as with the launcher; see
      // `AppWindow`.
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
      // Re-enabling the action is not a click, so the popup stays closed.
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
      // One window, so `gaps.smartGaps` gives it the whole area below the bar.
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
      // start under its title bar.
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
      // Over its window, not in its own frame.
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
      // `closeApp` is a request: the client may show a dialog and stay, so the
      // window goes only when the host reports it closed.
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");

      await user.click(screen.getByRole("button", { name: "Close" }));

      expect(domicile.calls).toContainEqual(["closeApp", "term"]);
      expect(windowsOnScreen(container)).toEqual(["term"]);
    });

    it("fills the screen from the button on the window's own bar", async () => {
      // The pointer equivalent of `mod+f`.
      const user = userEvent.setup();
      const { container } = renderShell();
      clientAppears("term");

      await user.click(screen.getByRole("button", { name: "Maximize" }));

      // A fullscreen window covers the top bar too.
      expect(boxOf(appElement(container, "term"))).toMatchObject({
        height: `${(1080 - TITLE_BAR).toString()}px`,
        y: `${TITLE_BAR.toString()}px`,
      });

      // The same button restores it.
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

    // A closed window is gone from the state at once, so the page draws its
    // exit from a snapshot; see `closing.ts`.
    it("plays a closed window out at the box it had, showing the window itself", () => {
      const { container } = renderShell();
      clientAppears("term");
      const was = boxOf(appElement(container, "term"));

      domicile.emit("app_closed", { app_id: "term" });

      // The window's own element, so its contents do not change as it leaves.
      expect(appElement(container, "term")).toHaveAttribute(
        "data-motion",
        "closing",
      );
      expect(boxOf(appElement(container, "term"))).toEqual(was);
    });

    // Closing the visible tab collapses it along the strip and fades its
    // contents, rather than shrinking the whole window over the next tab.
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
      // Its contents only fade, revealing the next tab underneath.
      expect(
        appElement(container, "editor").style.getPropertyValue("--collapse-x"),
      ).toBe("");
    });

    // Closing moves the keyboard elsewhere, so the closing bar keeps its
    // focused look from the snapshot.
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

    // The neighbor grows into its space while it shrinks. At equal `z-index`
    // document order would put the neighbor on top too early.
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
      // Hidden, not unmounted: remounting blanks a portal and reloads a page.
      const { container } = renderShell();
      clientAppears("term");

      press("parenright");
      motionsPlayOut(container);

      expect(windowsOnScreen(container)).toEqual([]);
      expect(appElement(container, "term")).toBeInTheDocument();
    });

    // Workspaces form a row: the arriving one slides in from its side and the
    // leaving one slides out the other way.
    it("slides one workspace off as the next one slides in", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("braceright");
      clientAppears("editor");

      press("parenleft");

      expect(moving(container)).toContain("leaving-to-end");
      expect(moving(container)).toContain("arriving-from-start");
    });

    // Scrims move with their windows.
    it("brings the scrims on with the workspace", () => {
      const { container } = renderShell();
      clientAppears("term");
      clientAppears("shell");
      press("e");
      press("braceright");
      clientAppears("editor");

      press("parenleft");

      expect(scrimOver(container, "app:term").className).toContain(
        movingStyles({ motion: "arriving-from-start" }),
      );
    });

    // Each workspace slides by its own screen's width, read from the window.
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

    // A window revealed by a workspace switch is not new, so it gets no
    // opening animation.
    it("does not play a window in when a workspace switch reveals it", () => {
      const { container } = renderShell();
      clientAppears("term");
      press("braceright");
      motionsPlayOut(container);

      press("parenleft");
      motionsPlayOut(container);

      expect(moving(container)).toEqual([]);
    });

    // `target="_blank"`, end to end: the guest page cannot open a window, so
    // the engine reports the address and the desktop opens a browser window.
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

    // Bitwarden's "Unlock", end to end: `chrome.windows.create` gives the
    // engine a window ID with nothing to show it; the desktop opens a browser
    // window for it.
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

    // `window.close()` or `chrome.tabs.remove`: the engine asks instead of
    // closing, and the window closes as its Close button would.
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
      // The bar is part of the window, so crossing onto it moves focus.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      pointerAt(1440, 800);

      crossInto(barFor(container, "app:one"), 300, TOP_BAR + 10);

      expect(barFor(container, "app:one").dataset.focus).toBe("focused");
    });

    it("moves the keyboard to a browser window whose page the pointer crosses into", async () => {
      // The same rule for a guest page: the shell sees the pointer enter its
      // element.
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

    it("sinks every window but the one being worked in, and rings none", () => {
      // Checked by declarations because Panda hashes class names.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");

      expect(dimmed(container, "app:one")).toBe(true);
      expect(dimmed(container, "app:two")).toBe(false);
      expect(container.querySelector("[data-selection]")).toBeNull();
      for (const id of ["one", "two"]) {
        expect(appElement(container, id).className).toContain(
          css({ borderColor: "borderStrong" }),
        );
      }
    });

    it("sinks nothing while the desk shows one tab group alone", () => {
      // There is nothing else on the desk to set the open tab apart from.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      expect(dimmed(container, "app:one")).toBe(false);
      expect(dimmed(container, "app:two")).toBe(false);
    });

    it("sinks a screen's only window while another screen is worked in", () => {
      // Alone on its screen, but the commands could target the window on the
      // other screen.
      const { container } = renderShell([LEFT, RIGHT]);
      clientAppears("one");
      clientAppears("two");
      press("parenright", true);

      expect(dimmed(container, "app:one")).toBe(false);
      expect(dimmed(container, "app:two")).toBe(true);
    });
  });

  describe("the keys, as the sway config binds them", () => {
    it("claims every chord it answers from the compositor", () => {
      // So presses reach the shell while a `<webview>` has the keyboard.
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
      // Every keysym in the defaults, on its own key.
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
      clientAppears("term");

      domicile.emit("shortcut", {
        altKey: false,
        ctrlKey: false,
        keycode: keys.get("q") ?? 0,
        metaKey: true,
        shiftKey: true,
      });

      expect(domicile.calls).toContainEqual(["closeApp", "term"]);
    });

    it("runs what `exec` names on the chord the config names", () => {
      renderShell();

      press("Return");

      expect(domicile.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("answers the same chord handed back by the host", () => {
      // A browser window has the keyboard, so the press arrives as a
      // `shortcut` message.
      renderShell();

      hostPress("Return");

      expect(domicile.calls).toContainEqual(["spawn", ["kitty"]]);
    });

    it("moves the focus with the direction keys", () => {
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("h");

      // The focused look on the bar is the only on-screen focus indicator.
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
      // `mod+v` wraps the focused window in a one-window column, so the window
      // moved toward it joins the column instead of swapping.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");

      press("v");
      press("h");
      press("l", true);

      // One column of two full-width windows, not a swap.
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

      // One tab each across the top. Both contents share a box, the focused
      // one on top, so the other is ready when its tab is picked.
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

    it("lights the whole group `focus parent` selects, and back", () => {
      // `mod+a` targets the container around the focus, and this highlight is
      // the only indication of which container.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      expect(dimmed(container, "app:one")).toBe(true);

      press("a");

      // Every window in it is undimmed and every bar raised, the focused one
      // marked apart.
      expect(dimmed(container, "app:one")).toBe(false);
      expect(barFor(container, "app:one").dataset.focus).toBe("selected");
      expect(barFor(container, "app:two").dataset.focus).toBe("leaf");
      // `mod+Shift+a` returns to the window.
      press("a", true);
      expect(dimmed(container, "app:one")).toBe(true);
      expect(barFor(container, "app:two").dataset.focus).toBe("focused");
    });

    it("lights a selected tab group's hidden tabs without raising them", () => {
      // A raised hidden tab would look open. A sibling window keeps the tabs
      // from filling the screen.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      press("v");
      clientAppears("three");
      press("w");

      press("a");

      expect(dimmed(container, "app:one")).toBe(true);
      expect(dimmed(container, "app:two")).toBe(false);
      expect(barFor(container, "app:two").dataset.focus).toBe("resting");
      expect(barFor(container, "app:three").dataset.focus).toBe("leaf");
    });

    it("runs the open tab's edge under the tabs beside it", () => {
      // A sibling window keeps the tabs from filling the screen.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("e");
      press("v");
      clientAppears("three");

      press("w");

      expect(barFor(container, "app:two").className).toContain(
        css({ borderBlockEndColor: "borderStrong" }),
      );
      expect(barFor(container, "app:three").className).toContain(
        css({ borderBlockEndColor: "transparent" }),
      );
    });

    it("grows each scrim in with the window it is over", () => {
      // A full-size scrim over a growing window would stick out past it.
      const { container } = renderShell();
      clientAppears("one");
      press("e");
      clientAppears("two");

      expect(scrimOver(container, "app:two").className).toContain(
        movingStyles({ motion: "opening" }),
      );
    });

    it("keeps the group when the layout slides a window under the pointer", () => {
      // Moving a group slides windows under a still pointer, and each fires
      // `pointerover` at the pointer's spot. Following those would hand focus,
      // and the selection, to whichever window passed by.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      press("v");
      clientAppears("three");
      pointerAt(1440, 800);

      press("a");
      press("h", true);

      crossInto(appElement(container, "one"), 1440, 800);
      expect(pointedAtGroup(container)).toBe(true);
    });

    it("knows its own warp, at a place that is not a whole pixel", () => {
      // Thirds of the workspace are not whole pixels, and the engine rounds
      // the warp (`base::ClampRound`). The page must still recognize its own
      // warp, or it treats the window under the cursor as a user's choice.
      const { container } = renderShell();
      clientAppears("one");
      clientAppears("two");
      clientAppears("three");
      press("e");
      press("h");
      press("h");
      press("v");
      pointerAt(1700, 900);

      // Move the group to the last of three.
      press("a");
      press("l", true);
      press("l", true);

      // The cursor lands on a rounded pixel over a window outside the group.
      // Only this rule keeps the crossing from taking the selection.
      const [x, y] = warpedTo();
      crossInto(appElement(container, "two"), Math.round(x), Math.round(y));

      expect(pointedAtGroup(container)).toBe(true);
    });

    it("and hands it over to a pointer that really crossed into one", () => {
      // A crossing at a point the pointer was not at is the user choosing a
      // window, and choosing one outside the group leaves it. The browser fires
      // `pointerover` before the move, so the desktop must act on it alone.
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
      expect(pointedAtGroup(container)).toBe(false);
    });

    it("fills the screen with the window being worked in", () => {
      const { container } = renderShell();
      clientAppears("term");

      press("f");

      // A fullscreen window covers the top bar too.
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
      // After the old workspace finishes sliding off, which keeps `one` drawn.
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

      // The focused window grows and its neighbor shrinks.
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

      // Its own box over the tiling, not the whole workspace.
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
      // Wider than the default float width of 1280 and shorter than its 770,
      // so both limits apply.
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
      // The window eases to its new box; a new bar would jump there instead.
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
      // The client owns the pointer over its surface, so the shell needs a
      // sheet on top to receive the drag.
      const { container } = renderShell();
      clientAppears("term");
      press("Tab", true);

      // The floating chord held the modifier; release it first.
      pageHolds({});
      expect(grabSheets(container)).toHaveLength(0);

      pageHolds({ meta: true });
      expect(grabSheets(container)).toHaveLength(1);
    });

    it("takes the sheet down when Meta comes up", () => {
      // Chromium on Wayland reports Meta's release with `metaKey` still set,
      // so the flag alone would leave the modifier stuck.
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

    it("keeps a float's scrim on it while it is dragged rather than easing after it", () => {
      // A transitioning scrim would trail the window during a drag.
      const { container } = renderShell();
      clientAppears("shell");
      clientAppears("term");
      press("Tab", true);
      const bar = barFor(container, "app:term");

      fireEvent.pointerDown(bar, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 100 });

      expect(scrimOver(container, "app:term").className).toContain(
        settlingStyles({ dragging: true }),
      );
    });

    it("drags a floating window onto the next screen and keeps hold of it", () => {
      // The screen under the float's center takes it, and the drag continues
      // after its bar leaves the pressed screen.
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
      // One `<webview>` throughout; a new one would reload the page.
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
      // One page spans the desk, so a float across two screens is one element.
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

      // Around the whole frame, at the window's depth, and earlier in the
      // document so each window paints over only its own shadow.
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
      // Its shadow would spill onto the next display.
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
      // The two move apart, swap depths, and return, every part of each
      // window included.
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
        scrimOver(container, "app:two"),
      ];
      const covered = [
        appElement(container, "one"),
        barFor(container, "app:one"),
        scrimOver(container, "app:one"),
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

    it("starts a scrim's shuffle over with its window's", () => {
      // Each press restarts the animation, for scrims as well as windows.
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
      expect(scrimOver(container, "app:one").className).toContain(
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
      // The window took focus without a key press. The pointer is still over
      // the previous window, and the next pointer event would take focus
      // back.
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
      // sway's `mouse_warping`: otherwise the next pointer event over the old
      // window would take focus back. The pointer goes to the center of the
      // window's contents, below its title bar.
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
      // sway's `focus right` onto an empty output. Otherwise the pointer on
      // the old screen would take focus back.
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
      // The bar, wallpaper and float decorations are not windows; taking focus
      // for them would make the desktop untypeable.
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

      // Granted, and its workspace is switched to.
      expect(domicile.calls).toContainEqual(["focusApp", "one"]);
      expect(screen.getByRole("button", { name: "1" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("moves the keyboard to the screen the pointer moves onto", () => {
      // As in sway, even an empty screen takes focus, so the next window opens
      // where the pointer is.
      const { container } = renderShell([LEFT, RIGHT]);

      pointerAt(2000, 500);
      clientAppears("term");

      // Shown there, not only assigned.
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
   * The launcher's box, matched by name because a browser window's address
   * bar is also a combobox.
   */
  const launcherBox = (): HTMLElement | null =>
    screen.queryByRole("combobox", {
      name: "Open an app, a file, a URL, or search",
    });

  /** Types into the launcher's box, which must be open. */
  const typeIntoLauncher = async (typed: string): Promise<void> => {
    await userEvent.setup().type(
      screen.getByRole("combobox", {
        name: "Open an app, a file, a URL, or search",
      }),
      typed,
    );
  };

  /** Each browser window's URL. */
  const browsing = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("webview")].map(
      (view) => view.getAttribute("src") ?? "",
    );

  /** Sets the files the host's index holds. */
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
    // Searched on each open, not at startup, so the results are current.
    renderShell();

    press("space");

    expect(launcherBox()).toBeVisible();
    expect(domicile.calls).toContainEqual(["searchFiles", ""]);
  });

  it("asks the host for its empty box's applications before it is opened", () => {
    // Unlike files, fetched before opening so late results do not push rows
    // down. See `launcher/useOpeningApps.ts`.
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

    // A row is the name, then its directories, separated by the grid's gap;
    // see `launcher/file-row.ts`.
    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(["Notestoday.org", "todo.txt"]);
    // Unmounted here: the preview timer could fire before shared cleanup and
    // update the panel outside `act`.
    unmount();
  });

  it("opens a file with the user's default application and puts the panel away", async () => {
    // The spawned shell resolves `$HOME`; the page cannot. See
    // `launcher/open-command.ts`.
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

    // The URL shows the search engine and escaping used.
    expect(browsing(container)).toStrictEqual([
      "https://en.wikipedia.org/wiki/Special:Search?search=mesa",
    ]);
  });

  it("takes the keyboard off the window it is opened over", () => {
    // The page draws the panel but the compositor routes keys. Without this,
    // the focused client would keep receiving the typed text.
    renderShell();
    clientAppears("one");
    domicile.emit("focus_changed", { app_id: "one" });
    domicile.calls.length = 0;

    press("space");

    expect(domicile.calls).toContainEqual(["focusChrome"]);
  });

  it("hands the keyboard back to the window when it is put away", () => {
    // Focus returns as soon as the panel closes, without waiting for the
    // pointer.
    renderShell();
    clientAppears("one");
    domicile.emit("focus_changed", { app_id: "one" });
    press("space");
    // The compositor confirms the focus change.
    domicile.emit("focus_changed", { app_id: undefined });
    domicile.calls.length = 0;

    press("space");

    expect(domicile.calls).toContainEqual(["focusApp", "one"]);
  });

  it("keeps the box focused over a browser window", async () => {
    // A guest page keeps pulling focus back to itself, so the panel must
    // hold it explicitly.
    const { container } = renderShell();
    press("space");
    await typeIntoLauncher("example.com{Enter}");
    expect(container.querySelector("webview")).not.toBeNull();

    press("space");

    expect(launcherBox()).toHaveFocus();
  });

  it("leaves nothing over the desktop once a launch puts it away", async () => {
    // The panel closes as the new window arrives. A leftover backdrop would
    // capture every click.
    const { baseElement } = renderShell([LEFT]);
    press("space");

    await typeIntoLauncher("example.com{Enter}");

    await waitFor(() => {
      expect(baseElement.querySelector("[data-backdrop]")).toBeNull();
    });
  });

  it("keeps the panel up while it closes", () => {
    // It stays drawn until the dialog's close animation finishes.
    renderShell();
    press("space");

    press("space");

    expect(screen.getByRole("dialog")).toHaveAttribute("data-ending-style");
  });

  it("answers the same key handed back by the host", () => {
    // A browser window has the keyboard, so `mod+space` arrives from the
    // host. This is the main way to open the launcher from a window.
    renderShell();

    hostPress("space");

    expect(launcherBox()).toBeVisible();
  });

  it("leaves the tab that was open selected once it is dismissed", async () => {
    // While the panel is up the engine may give focus back to the last guest,
    // here the hidden tab's browser. Dismissing must keep the visible tab
    // selected.
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
