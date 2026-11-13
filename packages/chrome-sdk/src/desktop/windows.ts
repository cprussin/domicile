// The desktop's client windows: what each is, which has the keyboard, and
// where the shell put them.

import type { DomicileHost, DomicileWindow } from "../domicile-host";
import type { Defined } from "./defined";
import { defined } from "./defined";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";
import type { System } from "./system-calls";

/** A client window, as the compositor last described it. */
export type ClientWindow = Defined<DomicileWindow>;

/** A box in the page's CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

export type WindowsListeners = {
  /** A window appeared, closed or changed. */
  change: () => void;
  /** {@link Windows.focused} may have moved. */
  focuschange: () => void;
  /** A client asked for the keyboard. Grant it with {@link Windows.focus}. */
  focusrequest: (appId: string) => void;
};

export type Windows = {
  /** Every client window, in the order they appeared. */
  readonly list: readonly ClientWindow[];
  /** The window holding the keyboard, or `undefined` while the shell holds it. */
  readonly focused: string | undefined;
  /** Give `appId` the keyboard. */
  focus: (appId: string) => void;
  /** Take the keyboard back to the shell's page. */
  focusShell: () => void;
  /** Ask a client to close. The client may refuse. */
  close: (appId: string) => void;
  /**
   * Say the page took the pointer for `appId`'s
   * {@link ClientWindow.pointerConstraint} (`active`), or let it go. Only once
   * taken is the client told its pointer is locked or confined.
   */
  pointerConstrained: (appId: string, active: boolean) => void;
  /** Where the shell put `appId`'s `<app>`; the client draws at that monitor's scale. */
  setBounds: (appId: string, box: Box) => void;
  /** Say the page renders each window's `frame` as its `<app frame>`. */
  syncFrames: () => void;
  setStates: System["setWindowStates"];
  requests: System["windowRequests"];
  bells: System["bells"];
  on: On<WindowsListeners>;
};

export type WindowsHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "closeApp"
  | "focusApp"
  | "focusChrome"
  | "focusedWindow"
  | "pointerConstrained"
  | "removeEventListener"
  | "setAppBounds"
  | "syncFrames"
  | "windows"
>;

export const windows = (
  host: WindowsHost,
  calls: Pick<System, "bells" | "setWindowStates" | "windowRequests">,
): Windows => {
  const listOf = memoizeLast((list: readonly DomicileWindow[]) =>
    list.map(defined),
  );
  return {
    bells: () => calls.bells(),
    close: (appId) => {
      host.closeApp(appId);
    },
    focus: (appId) => {
      host.focusApp(appId);
    },
    get focused() {
      return host.focusedWindow ?? undefined;
    },
    focusShell: () => {
      host.focusChrome();
    },
    get list() {
      return listOf(host.windows);
    },
    on: on<WindowsListeners>({
      change: (listener) => hostEvent(host, "windowschanged", () => listener()),
      focuschange: (listener) =>
        hostEvent(host, "focusedwindowchanged", () => listener()),
      focusrequest: (listener) =>
        hostEvent(host, "focusrequested", ({ appId }) => listener(appId)),
    }),
    pointerConstrained: (appId, active) => {
      host.pointerConstrained(appId, active);
    },
    requests: () => calls.windowRequests(),
    setBounds: (appId, { x, y, width, height }) => {
      host.setAppBounds(appId, x, y, width, height);
    },
    setStates: (appId, states) => calls.setWindowStates(appId, states),
    syncFrames: () => {
      host.syncFrames();
    },
  };
};
