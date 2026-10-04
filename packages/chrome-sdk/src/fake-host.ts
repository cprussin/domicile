// A `window.domicile` for a shell's tests. The test sets state, which
// dispatches the engine's change events, and every call the shell makes is
// recorded.
//
// ```ts
// const fake = new FakeDomicileHost();
// render(<Desktop domicile={fake.host} />);
// fake.appear("term", { title: "Terminal" });
// fake.dispatch("shortcut", { chord: "Meta+Return" });
// expect(fake.calls).toContainEqual(["spawn", ["kitty"]]);
// ```

import type {
  DomicileBrowserWindow,
  DomicileHost,
  DomicileHostEventMap,
  DomicileWindow,
} from "./domicile-host";

/** The attributes of `window.domicile` a test sets. */
export type DomicileState = {
  -readonly [K in keyof DomicileHost as DomicileHost[K] extends (
    ...args: never[]
  ) => unknown
    ? never
    : K]: DomicileHost[K];
};

/** The event the engine dispatches when each attribute changes. */
const CHANGED: Readonly<
  Record<keyof DomicileState, keyof DomicileHostEventMap>
> = {
  altKey: "modifierschanged",
  audioCards: "audiochanged",
  audioInputs: "audiochanged",
  audioOutputs: "audiochanged",
  audioPlayback: "audiochanged",
  audioRecording: "audiochanged",
  batteryCharge: "batterychanged",
  batteryCharging: "batterychanged",
  brightness: "brightnesschanged",
  browserWindows: "browserwindowschanged",
  clipboard: "clipboardchanged",
  ctrlKey: "modifierschanged",
  displays: "displayschanged",
  extensions: "extensionschanged",
  focusedWindow: "focusedwindowchanged",
  idle: "idlechanged",
  locked: "lockedchanged",
  metaKey: "modifierschanged",
  notifications: "notificationschanged",
  shiftKey: "modifierschanged",
  theme: "themechanged",
  tray: "traychanged",
  windows: "windowschanged",
  windowsTheme: "windowsthemechanged",
};

/** Every attribute before the compositor has sent anything. */
const UNDESCRIBED: DomicileState = {
  altKey: null,
  audioCards: null,
  audioInputs: null,
  audioOutputs: null,
  audioPlayback: null,
  audioRecording: null,
  batteryCharge: null,
  batteryCharging: null,
  brightness: null,
  browserWindows: null,
  clipboard: null,
  ctrlKey: null,
  displays: null,
  extensions: null,
  focusedWindow: null,
  idle: null,
  locked: null,
  metaKey: null,
  notifications: null,
  shiftKey: null,
  theme: null,
  tray: null,
  windows: [],
  windowsTheme: null,
};

/** A window as the engine lists it before its client has sent anything. */
export const describedWindow = (
  appId: string,
  fields: Partial<DomicileWindow> = {},
): DomicileWindow => ({
  appId,
  cursor: "default",
  grab: false,
  height: null,
  maxHeight: null,
  maxWidth: null,
  minHeight: null,
  minWidth: null,
  parent: null,
  title: "",
  width: null,
  x: null,
  y: null,
  ...fields,
});

/** The methods that return a promise. The fake's never settle. */
const ASKS = new Set(["previewFile", "searchApps", "searchFiles"]);

export class FakeDomicileHost {
  /** Every call the shell made, in order: the method's name, then its arguments. */
  readonly calls: (readonly [method: string, ...args: unknown[]])[] = [];

  /** What the shell is handed as `window.domicile`. */
  readonly host: DomicileHost;

  readonly #target = new EventTarget();
  readonly #state: DomicileState = { ...UNDESCRIBED };
  #browsersOpened = 0;

  constructor() {
    const target = this.#target;
    const state = this.#state;
    const calls = this.calls;
    this.host = new Proxy({} as DomicileHost, {
      get: (_, name) => {
        if (typeof name !== "string") {
          return undefined;
        } else if (Object.hasOwn(state, name)) {
          return state[name as keyof DomicileState];
        } else if (name === "openBrowserWindow") {
          return (url: string) => {
            calls.push([name, url]);
            this.openBrowser(url);
          };
        } else if (name === "closeBrowserWindow") {
          return (id: string) => {
            calls.push([name, id]);
            this.closeBrowser(id);
          };
        } else if (
          name === "addEventListener" ||
          name === "removeEventListener" ||
          name === "dispatchEvent"
        ) {
          return target[name].bind(target);
        } else {
          return (...args: unknown[]) => {
            calls.push([name, ...args]);
            return ASKS.has(name) ? new Promise(() => undefined) : undefined;
          };
        }
      },
      has: (_, name) => typeof name === "string",
    });
  }

  /** Set attributes, then dispatch each change event they owe, once. */
  set(changes: Partial<DomicileState>): void {
    Object.assign(this.#state, changes);
    for (const type of new Set(
      Object.keys(changes).map((name) => CHANGED[name as keyof DomicileState]),
    )) {
      this.#target.dispatchEvent(new Event(type));
    }
  }

  /** A window appeared: the end of `windows`. */
  appear(appId: string, fields: Partial<DomicileWindow> = {}): void {
    this.set({
      windows: [
        ...this.#state.windows.filter((window) => window.appId !== appId),
        describedWindow(appId, fields),
      ],
    });
  }

  /** What the compositor says of a window that is open. */
  change(appId: string, fields: Partial<DomicileWindow>): void {
    this.set({
      windows: this.#state.windows.map((window) =>
        window.appId === appId ? { ...window, ...fields } : window,
      ),
    });
  }

  /** A window closed. */
  close(appId: string): void {
    this.set({
      windows: this.#state.windows.filter((window) => window.appId !== appId),
    });
  }

  /**
   * The engine opened a browser window at `url`, as for `domicile open-url`,
   * `target="_blank"`, or with `popupWindow` an extension's popup window.
   * `openBrowserWindow` calls this too. Ids count up from `"1"`; the asked-for
   * size is 0.
   */
  openBrowser(url: string, popupWindow: number | null = null): void {
    this.#browsersOpened += 1;
    this.set({
      browserWindows: [
        ...(this.#state.browserWindows ?? []),
        {
          height: 0,
          id: this.#browsersOpened.toString(),
          popupWindow,
          title: "",
          url,
          width: 0,
        } satisfies DomicileBrowserWindow,
      ],
    });
  }

  /** The engine closed browser window `id`. `closeBrowserWindow` calls this too. */
  closeBrowser(id: string): void {
    this.set({
      browserWindows: (this.#state.browserWindows ?? []).filter(
        (window) => window.id !== id,
      ),
    });
  }

  /** Dispatch a moment, such as `shortcut` or `focusrequested`, with its fields. */
  dispatch<T extends keyof DomicileHostEventMap>(
    type: T,
    fields: Partial<Omit<DomicileHostEventMap[T], keyof Event>> = {},
  ): void {
    this.#target.dispatchEvent(Object.assign(new Event(type), fields));
  }
}
