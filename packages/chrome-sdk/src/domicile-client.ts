// The in-page client for `window.domicile`.
//
// The engine gives a shell's document a `DomicileHost`: an `EventTarget` with
// typed methods. This class adds what a shell needs on top of it:
//
// - It listens for every event in its constructor and holds messages until
//   the page registers a handler (see {@link DomicileClient.#held}). A DOM
//   event with no listener is lost, and a React shell registers handlers in
//   its first effect, after the compositor has announced running clients.
//   Shells must not call `addEventListener` on `window.domicile` directly.
// - No event can arrive before the constructor's listeners exist. The channel
//   binds on the first `addEventListener`, and nothing is dispatched until it
//   binds.
// - `host-message.ts` translates WebIDL event shapes into the messages a shell
//   handles. The translators live there so they can be tested; a throw inside
//   a DOM listener goes to the page's error handler, not the test.

import type {
  DomicileBrowserWindow,
  DomicileDisplay,
  DomicileHost,
  DomicileShortcut,
} from "./domicile-host";
import { setFocusedApp } from "./element-context";
import type {
  FilePreviewMessage,
  FoundAppsMessage,
  FoundFilesMessage,
  HostMessageOf,
  HostMessageType,
} from "./host-message";
import {
  appAppeared,
  appClosed,
  appCursor,
  appResized,
  appSizeLimit,
  appTitled,
  audio,
  audioLevels,
  battery,
  clipboard,
  extensions,
  filePreview,
  focusChanged,
  focusRequested,
  foundApps,
  foundFiles,
  idle,
  locked,
  modifiers,
  notifications,
  popupPlaced,
  shellConfig,
  shortcut,
  theme,
  tray,
} from "./host-message";
import { claimShortcut } from "./shortcut-claims";
import type { Theme } from "./theme";
import type { TrayAction } from "./tray";
import type { AxisDelta } from "./wheel-axis";

type Handler = (message: never) => void;

/**
 * A client surface's size in its own pixels.
 *
 * Where optional, `undefined` means the client has not committed a buffer yet.
 */
export type SurfaceSize = readonly [width: number, height: number];

/**
 * The chrome's side of the control channel: handlers for compositor messages
 * and a typed method per request.
 */
export class DomicileClient {
  readonly #host: DomicileHost;
  readonly #handlers = new Map<HostMessageType, Handler>();

  /**
   * Messages that arrived before any handler for their type, in arrival order.
   *
   * The compositor sends `app_appeared` for running clients as soon as the
   * channel binds, before a React page's first effect registers handlers. A
   * window is announced only once, so dropping these would lose it.
   *
   * Unbounded: a type is held only until its first handler registers, and
   * never after {@link #released}.
   */
  readonly #held = new Map<HostMessageType, unknown[]>();
  /**
   * Types the page stopped listening for with {@link off}. These are no
   * longer held, since nothing may drain them.
   *
   * Messages between an {@link off} and a later {@link on} are lost. Only
   * release a type whose state the page can recover, e.g. {@link displays};
   * not `app_appeared`, which is sent once per window.
   */
  readonly #released = new Set<HostMessageType>();

  /**
   * Each client's last surface size, for the SDK's pointer scaling. Recorded
   * here so it does not take the shell's `app_resized` handler slot.
   */
  readonly #surfaceSizes = new Map<string, SurfaceSize>();

  /** Each open popup's parent, by popup id; see {@link windowOf}. */
  readonly #popupParents = new Map<string, string>();

  /**
   * Pending file searches, by query.
   *
   * Keyed by query because each answer names its query, so a stale answer to
   * `n` never settles a search for `no`.
   */
  readonly #searches = new Map<
    string,
    ((found: FoundFilesMessage) => void)[]
  >();

  /** Pending application searches, by query. */
  readonly #appSearches = new Map<
    string,
    ((found: FoundAppsMessage) => void)[]
  >();

  /** Pending file previews, by path. */
  readonly #previews = new Map<
    string,
    ((preview: FilePreviewMessage) => void)[]
  >();

  constructor(host: DomicileHost) {
    this.#host = host;

    // Register every listener before returning; see the module comment.
    host.addEventListener("appappeared", (event) => {
      const message = appAppeared(event);
      // Record the size here too: on reconnect, no `app_resized` follows for a
      // client whose size has not changed.
      if (message.size !== undefined) {
        this.#surfaceSizes.set(message.app_id, message.size);
      }
      this.#deliver("app_appeared", message);
    });
    host.addEventListener("apptitled", (event) => {
      this.#deliver("app_titled", appTitled(event));
    });
    host.addEventListener("appresized", (event) => {
      const message = appResized(event);
      this.#surfaceSizes.set(message.app_id, message.size);
      this.#deliver("app_resized", message);
    });
    host.addEventListener("appminsize", (event) => {
      this.#deliver("app_min_size", appSizeLimit(event));
    });
    host.addEventListener("appmaxsize", (event) => {
      this.#deliver("app_max_size", appSizeLimit(event));
    });
    host.addEventListener("popupplaced", (event) => {
      const message = popupPlaced(event);
      this.#surfaceSizes.set(message.app_id, message.size);
      this.#popupParents.set(message.app_id, message.parent);
      this.#deliver("popup_placed", message);
    });
    host.addEventListener("appclosed", (event) => {
      const message = appClosed(event);
      this.#surfaceSizes.delete(message.app_id);
      this.#popupParents.delete(message.app_id);
      this.#deliver("app_closed", message);
    });
    host.addEventListener("appcursor", (event) => {
      this.#deliver("app_cursor", appCursor(event));
    });
    host.addEventListener("focuschanged", (event) => {
      const message = focusChanged(event);
      // Track focus from the compositor, not only the page's own requests: the
      // compositor also moves focus, and keys must follow it.
      setFocusedApp(message.app_id);
      this.#deliver("focus_changed", message);
    });
    host.addEventListener("focusrequested", (event) => {
      this.#deliver("focus_requested", focusRequested(event));
    });
    host.addEventListener("shortcut", (event) => {
      this.#deliver("shortcut", shortcut(event));
    });
    host.addEventListener("modifiers", (event) => {
      this.#deliver("modifiers", modifiers(event));
    });
    host.addEventListener("files", (event) => {
      const found = foundFiles(event);
      for (const settle of this.#searches.get(found.query) ?? []) {
        settle(found);
      }
      this.#searches.delete(found.query);
    });
    host.addEventListener("filepreview", (event) => {
      const previewed = filePreview(event);
      for (const settle of this.#previews.get(previewed.path) ?? []) {
        settle(previewed);
      }
      this.#previews.delete(previewed.path);
    });
    host.addEventListener("apps", (event) => {
      const found = foundApps(event);
      for (const settle of this.#appSearches.get(found.query) ?? []) {
        settle(found);
      }
      this.#appSearches.delete(found.query);
    });
    host.addEventListener("battery", (event) => {
      this.#deliver("battery", battery(event));
    });
    // The event has no payload; the engine sets the list before dispatching.
    host.addEventListener("browserwindowschanged", () => {
      const windows = this.#host.browserWindows;
      if (windows !== null) {
        this.#deliver("browser_windows", { windows });
      }
    });
    // The event has no payload; the engine sets the attribute before
    // dispatching.
    host.addEventListener("brightnesschanged", () => {
      const level = this.#host.brightness;
      if (level !== null) {
        this.#deliver("brightness", { level });
      }
    });
    host.addEventListener("clipboard", (event) => {
      this.#deliver("clipboard", clipboard(event));
    });
    host.addEventListener("theme", (event) => {
      this.#deliver("theme", theme(event));
    });
    host.addEventListener("idle", (event) => {
      this.#deliver("idle", idle(event));
    });
    host.addEventListener("locked", (event) => {
      this.#deliver("locked", locked(event));
    });
    host.addEventListener("extensions", (event) => {
      this.#deliver("extensions", extensions(event));
    });
    host.addEventListener("tray", (event) => {
      this.#deliver("tray", tray(event));
    });
    host.addEventListener("notifications", (event) => {
      this.#deliver("notifications", notifications(event));
    });
    host.addEventListener("windowstheme", (event) => {
      this.#deliver("windows_theme", theme(event));
    });
    host.addEventListener("shellconfig", (event) => {
      this.#deliver("shell_config", shellConfig(event));
    });
    host.addEventListener("audio", (event) => {
      this.#deliver("audio", audio(event));
    });
    host.addEventListener("audiolevels", (event) => {
      this.#deliver("audio_levels", audioLevels(event));
    });
    host.addEventListener("displayschanged", () => {
      // The event has no payload; the engine sets the attribute before
      // dispatching. Read it now so a held message keeps its own snapshot.
      const described = this.#host.displays;
      // `null` cannot happen from a real host. Drop it rather than deliver
      // `[]`, which would mean a desktop with no screens.
      if (described !== null) {
        this.#deliver("displays", { displays: described });
      }
    });
  }

  /**
   * The displays the compositor described, or `undefined` until it has.
   *
   * Read from the host each time, so late readers see the current desktop.
   * `undefined` (not described yet) and `[]` (no screens) are distinct.
   * Geometry is in logical CSS pixels; `scale` is the client scale for that
   * screen, not this page's `devicePixelRatio`.
   */
  get displays(): readonly DomicileDisplay[] | undefined {
    return this.#host.displays ?? undefined;
  }

  /**
   * The browser windows, or `undefined` until the browser lists them.
   *
   * Read from the host each time, so late readers see the current list. Draw
   * each with `<webview window={id}>`.
   */
  get browserWindows(): readonly DomicileBrowserWindow[] | undefined {
    return this.#host.browserWindows ?? undefined;
  }

  /**
   * The last surface size of client `appId`, or `undefined` before it draws.
   *
   * Used to scale pointer positions from the element's box to the surface.
   * Callers map 1:1 when it is `undefined`.
   */
  surfaceSizeOf(appId: string): SurfaceSize | undefined {
    return this.#surfaceSizes.get(appId);
  }

  /**
   * The top-level window for `appId`: itself, or a popup's root window. A
   * click on a popup focuses this window.
   */
  windowOf(appId: string): string {
    const parent = this.#popupParents.get(appId);
    return parent === undefined ? appId : this.windowOf(parent);
  }

  /**
   * Register the handler for a host message `type` (e.g. `app_appeared`).
   *
   * Anything of that type that arrived before this call is delivered to
   * `handler` synchronously, in the order it arrived — see {@link #held}.
   */
  on<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    this.#handlers.set(type, handler as Handler);
    const waiting = this.#held.get(type);
    // Clear before running the handler, so a message it triggers is not
    // replayed from the hold.
    this.#held.delete(type);
    for (const message of waiting ?? []) {
      handler(message as HostMessageOf<T>);
    }
    return this;
  }

  /**
   * Stop delivering `type` to `handler`.
   *
   * Does nothing if another handler has since replaced `handler`, so teardown
   * order does not matter. Messages of `type` are no longer held; see
   * {@link #released}.
   */
  off<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    if (this.#handlers.get(type) === handler) {
      this.#handlers.delete(type);
      this.#released.add(type);
    }
    return this;
  }

  /**
   * Request a theme change.
   *
   * Render from the `theme` message that every chrome page receives, not from
   * the click, so all pages stay in sync. The compositor also serves the
   * theme to clients through the settings portal.
   */
  setTheme(theme: Theme): void {
    this.#host.setTheme(theme);
  }

  /**
   * Submit a passphrase to unlock the session.
   *
   * Clear the lock screen only on the `locked: false` message every chrome
   * page receives; otherwise devtools could unlock it. A wrong passphrase is
   * answered with `locked: true`.
   */
  unlock(passphrase: string): void {
    this.#host.unlock(passphrase);
  }

  /**
   * Lock the session. Draw the lock screen on the `locked` message. See
   * {@link DomicileHost.lock}.
   */
  lock(): void {
    this.#host.lock();
  }

  /**
   * Set the backlight to `level`, from 0 to 1. Update UI from the
   * `brightness` message. See {@link DomicileHost.setBrightness}.
   */
  setBrightness(level: number): void {
    this.#host.setBrightness(level);
  }

  /**
   * Set a device's or stream's volume as a fraction of 100%. Update UI from
   * the `audio` message. See {@link DomicileHost.setAudioVolume}.
   */
  setAudioVolume(id: string, volume: number): void {
    this.#host.setAudioVolume(id, volume);
  }

  /** Mute or unmute a device or stream; answered by `audio`. */
  setAudioMuted(id: string, muted: boolean): void {
    this.#host.setAudioMuted(id, muted);
  }

  /** Make a device the default for new streams; answered by `audio`. */
  setDefaultAudioDevice(id: string): void {
    this.#host.setDefaultAudioDevice(id);
  }

  /**
   * Move a stream to another device of the same direction; answered by
   * `audio`.
   */
  moveAudioStream(id: string, device: string): void {
    this.#host.moveAudioStream(id, device);
  }

  /** Switch a device to one of its ports; answered by `audio`. */
  setAudioPort(id: string, port: string): void {
    this.#host.setAudioPort(id, port);
  }

  /** Switch a sound card to one of its profiles; answered by `audio`. */
  setAudioProfile(card: string, profile: string): void {
    this.#host.setAudioProfile(card, profile);
  }

  /**
   * Meter these devices and streams; answered by `audio_levels`. Renew every
   * second; see {@link DomicileHost.watchAudioLevels}.
   */
  watchAudioLevels(ids: readonly string[]): void {
    this.#host.watchAudioLevels(ids);
  }

  /**
   * Report that this page has captured its old frame for `theme`, so windows
   * can switch. Answered by `windows_theme`. See
   * {@link DomicileHost.themeCaptured}.
   */
  themeCaptured(theme: Theme): void {
    this.#host.themeCaptured(theme);
  }

  /**
   * Ask the compositor to focus `appId`'s client.
   *
   * Shells should use `focusApp` from `./focus-app`, which also routes the
   * page's key events to the client. This alone leaves keys in the page.
   */
  focusApp(appId: string): void {
    this.#host.focusApp(appId);
  }

  focusChrome(): void {
    this.#host.focusChrome();
  }

  /**
   * Move the pointer to `to`, in page coordinates.
   *
   * For focus-follows-mouse shells: after a keyboard focus change, warp the
   * pointer so it does not refocus the old window (like sway's
   * `mouse_warping`).
   */
  warpPointer(to: readonly [x: number, y: number]): void {
    this.#host.warpPointer(to[0], to[1]);
  }

  /**
   * Ask the client owning `appId` to close its window.
   *
   * The client may refuse, e.g. to prompt about unsaved work. Remove the
   * window on `app_closed`.
   */
  closeApp(appId: string): void {
    this.#host.closeApp(appId);
  }

  /** Ask the compositor to spawn a client process (argv array). */
  spawn(command: readonly string[]): void {
    this.#host.spawn(command);
  }

  /**
   * Search the home directory for files matching every word of `query`, in
   * any order, ignoring case.
   *
   * Returns the top matches and the total count. The page cannot choose the
   * searched path. See `DomicileHost.searchFiles`.
   *
   * Never settles if the compositor has no index (e.g. no `HOME`); it logs
   * the error rather than answer with an empty result.
   */
  searchFiles(query: string): Promise<FoundFilesMessage> {
    return new Promise((settle) => {
      this.#searches.set(query, [...(this.#searches.get(query) ?? []), settle]);
      this.#host.searchFiles(query);
    });
  }

  /**
   * Preview the start of a file or directory, for a launcher.
   *
   * `path` must come from {@link searchFiles}; any other path is answered
   * `Unreadable`. Never settles without an index, like a search.
   */
  previewFile(path: string): Promise<FilePreviewMessage> {
    return new Promise((settle) => {
      this.#previews.set(path, [...(this.#previews.get(path) ?? []), settle]);
      this.#host.previewFile(path);
    });
  }

  /**
   * Search installed applications, best first, each with an argv for
   * {@link spawn}. See `DomicileHost.searchApps`.
   */
  searchApps(query: string): Promise<FoundAppsMessage> {
    return new Promise((settle) => {
      this.#appSearches.set(query, [
        ...(this.#appSearches.get(query) ?? []),
        settle,
      ]);
      this.#host.searchApps(query);
    });
  }

  /**
   * Put a clipboard history entry back on the clipboard.
   *
   * `entry` is an id from the last `clipboard` message. The compositor serves
   * the paste, so it works after the source client exits. An unknown id is
   * logged and changes nothing.
   */
  copyClipboardEntry(entry: number): void {
    this.#host.copyClipboardEntry(entry);
  }

  /**
   * Click an extension's action, like Chrome's toolbar button.
   *
   * Grants `activeTab` on the focused browser window and, if there is no
   * popup, dispatches `action.onClicked`. For a popup, the shell then opens a
   * `<webview>` at its `popup` URL.
   */
  activateExtension(id: string): void {
    this.#host.activateExtension(id);
  }

  /**
   * Opens a browser window at `url`, for the shell's own UI. It arrives in the
   * next `browser_windows`.
   */
  openBrowserWindow(url: string): void {
    this.#host.openBrowserWindow(url);
  }

  /** Closes browser window `id`. It leaves the next `browser_windows`. */
  closeBrowserWindow(id: string): void {
    this.#host.closeBrowserWindow(id);
  }

  /**
   * Click a tray icon, by `id` from the last `tray` message. Any change
   * arrives as the next `tray` message.
   */
  activateTrayItem(id: string, action: TrayAction): void {
    this.#host.activateTrayItem(id, action);
  }

  /**
   * Dismiss notifications, by ids from the last `notifications` message.
   */
  dismissNotifications(ids: readonly number[]): void {
    this.#host.dismissNotifications(ids);
  }

  /**
   * Invoke a notification action, or `"default"` to click a `clickable`
   * notification. The notification is then dismissed.
   */
  invokeNotificationAction(id: number, action: string): void {
    this.#host.invokeNotificationAction(id, action);
  }

  /**
   * Grab a key chord for the shell, whatever has keyboard focus.
   *
   * Registered twice. The host grab works inside a `<webview>`, where the
   * browser process matches it and sends a `shortcut` message with the same
   * fields. The page grab (`shortcut-claims.ts`) stops `keyboard-input.ts`
   * forwarding the chord to a focused Wayland window.
   */
  grabShortcut(shortcut: DomicileShortcut): void {
    claimShortcut(shortcut);
    this.#host.grabShortcut(shortcut);
  }

  // ---- input forwarding ---------------------------------------------------

  pointerMotion(appId: string, x: number, y: number): void {
    this.#host.pointerMotion(appId, x, y);
  }

  pointerLeave(appId: string): void {
    this.#host.pointerLeave(appId);
  }

  pointerButton(appId: string, button: number, pressed: boolean): void {
    this.#host.pointerButton(appId, button, pressed);
  }

  pointerAxis(appId: string, { dx, dy, v120X, v120Y }: AxisDelta): void {
    this.#host.pointerAxis(appId, dx, dy, v120X, v120Y);
  }

  key(appId: string, keycode: number, pressed: boolean): void {
    this.#host.key(appId, keycode, pressed);
  }

  /**
   * Deliver a message to its handler, or hold it until one registers. Drop
   * it if its type is {@link #released}.
   */
  #deliver<T extends HostMessageType>(
    type: T,
    message: HostMessageOf<T>,
  ): void {
    const handler = this.#handlers.get(type);
    if (handler !== undefined) {
      handler(message as never);
    } else if (!this.#released.has(type)) {
      const waiting = this.#held.get(type);
      if (waiting === undefined) {
        this.#held.set(type, [message]);
      } else {
        waiting.push(message);
      }
    }
  }
}
