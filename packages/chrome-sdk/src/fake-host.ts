// A `window.domicile` for a shell's tests: the desk's state, set by the test
// and announced with the event the engine would dispatch, and a record of
// every call the shell makes.
//
// ```ts
// const fake = new FakeDomicileHost();
// render(<Desktop domicile={fake.host} />);
// fake.appear("term", { title: "Terminal" });
// fake.dispatch("shortcut", { chord: "Meta+Return" });
// expect(fake.calls).toContainEqual(["spawn", ["kitty"]]);
// ```

import type {
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

/** The event a change of each attribute dispatches, as the engine's does. */
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

/** Every attribute as the engine has it before a compositor said anything. */
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

/** A window as the engine lists it before its client has said anything. */
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

/** The asks that answer with a promise: never settled unless a test says. */
const ASKS = new Set(["previewFile", "searchApps", "searchFiles"]);

export class FakeDomicileHost {
  /** Every call the shell made, in order: the method's name, then its arguments. */
  readonly calls: (readonly [method: string, ...args: unknown[]])[] = [];

  /** What the shell is handed as `window.domicile`. */
  readonly host: DomicileHost;

  readonly #target = new EventTarget();
  readonly #state: DomicileState = { ...UNDESCRIBED };

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

  /** A moment — `shortcut`, `openurl`, `focusrequested` — with its fields. */
  dispatch<T extends keyof DomicileHostEventMap>(
    type: T,
    fields: Partial<Omit<DomicileHostEventMap[T], keyof Event>> = {},
  ): void {
    this.#target.dispatchEvent(Object.assign(new Event(type), fields));
  }
}
