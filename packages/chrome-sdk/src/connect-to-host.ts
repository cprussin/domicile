// Finds the compositor, or a no-op stand-in when there is none.
//
// In the engine, a page served over `domicile://` gets `window.domicile`. In
// an ordinary browser (e.g. `vite dev`) there is no compositor, and the shell
// must still render. See docs/WRITING-A-SHELL.md.

import type { DomicileHost } from "./domicile-host";

/**
 * The global to read `domicile` from; a parameter so tests can supply one.
 *
 * `window` and `navigator` both work: `window.domicile` aliases
 * `navigator.domicile`.
 */
export type HostGlobal = {
  readonly domicile?: DomicileHost | null;
};

/** Default reporter for a missing compositor. */
const warnOnConsole = (message: string): void => {
  // biome-ignore lint/suspicious/noConsole: the only channel to the author
  console.warn(message);
};

/**
 * Whether a compositor is behind this page. Without one, a shell should lay
 * out against the viewport.
 */
export const hasHost = (global: HostGlobal): boolean =>
  compositorOn(global) !== undefined;

/**
 * The compositor behind this page, or a no-op stand-in.
 *
 * The stand-in must not throw, so a shell can be developed in an ordinary
 * browser. It warns once, because otherwise missing windows look like a shell
 * or client bug.
 *
 * @param warn - Where the warning goes. Injected for tests.
 */
export const connectToHost = (
  global: HostGlobal,
  warn: typeof warnOnConsole = warnOnConsole,
): DomicileHost => {
  const compositor = compositorOn(global);
  if (compositor === undefined) {
    warn(
      "domicile: there is no compositor behind this page —" +
        " window.domicile is absent, so this document was not served by" +
        " the forked engine. The shell will lay out and style as usual; no" +
        " window will ever appear in it, nothing it asks the compositor for" +
        " will happen, and no desktop will be described.",
    );
  }
  return compositor ?? absentHost();
};

/**
 * The compositor, or `undefined`.
 *
 * The property is absent outside the engine, and `null` in a document with no
 * frame. This converts WebIDL's `null` to `undefined`; see
 * docs/guidelines/CONTROL_FLOW.md.
 */
const compositorOn = (global: HostGlobal): DomicileHost | undefined =>
  global.domicile ?? undefined;

/**
 * A `DomicileHost` whose members all do nothing.
 *
 * It implements every member because the client calls `addEventListener` in
 * its constructor. `displays` is `null` (not yet described), not `[]` (a
 * desktop with no screens).
 */
const absentHost = (): DomicileHost => ({
  activateExtension: () => undefined,
  activateTrayItem: () => undefined,
  addEventListener: () => undefined,
  brightness: null,
  browserWindows: null,
  closeApp: () => undefined,
  closeBrowserWindow: () => undefined,
  copyClipboardEntry: () => undefined,
  dismissNotifications: () => undefined,
  displays: null,
  focusApp: () => undefined,
  focusChrome: () => undefined,
  grabShortcut: () => undefined,
  invokeNotificationAction: () => undefined,
  key: () => undefined,
  lock: () => undefined,
  moveAudioStream: () => undefined,
  openBrowserWindow: () => undefined,
  pointerAxis: () => undefined,
  pointerButton: () => undefined,
  pointerLeave: () => undefined,
  pointerMotion: () => undefined,
  previewFile: () => undefined,
  searchApps: () => undefined,
  searchFiles: () => undefined,
  setAudioMuted: () => undefined,
  setAudioPort: () => undefined,
  setAudioProfile: () => undefined,
  setAudioVolume: () => undefined,
  setBrightness: () => undefined,
  setDefaultAudioDevice: () => undefined,
  setTheme: () => undefined,
  spawn: () => undefined,
  themeCaptured: () => undefined,
  unlock: () => undefined,
  warpPointer: () => undefined,
  watchAudioLevels: () => undefined,
});
