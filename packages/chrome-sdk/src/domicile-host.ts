// Types for `window.domicile`, the shell's channel to the compositor.
//
// This mirrors the engine's WebIDL in
// `packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
// If they disagree, the IDL is correct. See
// `docs/architecture/WINDOW-DOMICILE.md`.
//
// The host exists only in Domicile's engine, so the globals are optional.
// `connect-to-host.ts` handles the missing case.
//
// Sizes and coordinates are fractional CSS pixels, except in
// {@link DomicileDisplay}. Keycodes are Linux evdev codes.

import type { CursorShape } from "./cursor-shape";
import type { Theme } from "./theme";
import type { TrayAction } from "./tray";

/**
 * A key combination the shell claims, matching {@link DomicileShortcutEvent}.
 *
 * An omitted modifier defaults to `false`, so it must not be held.
 */
export type DomicileShortcut = {
  /** An evdev code. Zero is not a key and the engine refuses it. */
  keycode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

/**
 * One screen of the desktop.
 *
 * Sizes are integers because they come from the config, not from layout.
 */
export type DomicileDisplay = {
  /**
   * The screen's name from the config, such as `left`, or `domicile-0` when
   * Domicile runs in a window instead of driving displays.
   */
  readonly name: string;
  /**
   * The top-left corner in desktop coordinates, which start at the top-left
   * of the displays' bounding box. Can be negative.
   */
  readonly x: number;
  readonly y: number;
  /** Logical size in CSS pixels. The `wl_output` mode is this × `scale`. */
  readonly width: number;
  readonly height: number;
  /**
   * The scale clients on this screen render at. This is not the shell's
   * `devicePixelRatio`; do not use it for layout.
   */
  readonly scale: number;
  /**
   * The panel's physical mode in pixels, before rotation.
   *
   * It cannot be derived from `width`, `height` and `scale`. Zero when the
   * compositor reports no mode. For display only.
   */
  readonly modeWidth: number;
  readonly modeHeight: number;
  /**
   * The monitor's rotation: `normal`, `rotate-90`, `rotate-180` or
   * `rotate-270`.
   *
   * Uses `wl_output` naming, which counts counterclockwise: `rotate-90` turns
   * content a quarter turn counterclockwise.
   */
  readonly transform: string;
};

/**
 * One client window, as {@link DomicileHost.windows} lists it: what the
 * compositor has said about it so far. Replaced, never edited — any change is
 * a new `windows` array and a `windowschanged`.
 */
export type DomicileWindow = {
  readonly appId: string;
  /** Empty until the client names itself. */
  readonly title: string;
  /** The size the client last committed, in CSS pixels; `null` until it has. */
  readonly width: number | null;
  readonly height: number | null;
  /** The limits the client asked for; `null` where it asked for none. */
  readonly minWidth: number | null;
  readonly minHeight: number | null;
  readonly maxWidth: number | null;
  readonly maxHeight: number | null;
  readonly cursor: CursorShape;
  /** A popup's parent window; `null` for a toplevel. */
  readonly parent: string | null;
  /** A popup's place relative to its parent; `null` for a toplevel. */
  readonly x: number | null;
  readonly y: number | null;
  /** Whether a popup grabbed the pointer; `false` for a toplevel. */
  readonly grab: boolean;
};

/**
 * A window event: appeared, resized, closed, focus changed, and similar.
 *
 * Fields an event type does not use are empty or zero. `host-message.ts`
 * turns each event into a payload with only its own fields.
 */
export type DomicileAppEvent = Event & {
  /** The window's id. Empty on `focuschanged` means the chrome has focus. */
  readonly appId: string;
  readonly title: string;
  /**
   * False until the client has committed a buffer.
   *
   * A window can appear before it has a size. Ignore `width` and `height`
   * while this is false.
   */
  readonly hasSize: boolean;
  readonly width: number;
  readonly height: number;

  /**
   * `popupplaced` only: the popup's parent, and its offset from the parent's
   * top-left in CSS pixels.
   */
  readonly parentAppId: string;
  readonly x: number;
  readonly y: number;
  /** `popupplaced` only: `true` for a menu, `false` for a tooltip. */
  readonly grab: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A client set the cursor shape over its window. */
export type DomicileAppCursorEvent = Event & {
  readonly appId: string;

  /**
   * The CSS `cursor` keyword the client asked for.
   *
   * `host-message.ts` still validates it, because the SDK and engine ship
   * separately and their lists can differ.
   */
  readonly cursor: CursorShape;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A window's title was set or changed. */
export type DomicileAppTitledEvent = Event & {
  readonly appId: string;
  readonly title: string;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A combination claimed with `grabShortcut()` was pressed. */
export type DomicileShortcutEvent = Event & {
  /**
   * The chord as {@link DomicileHost.grabShortcut} was given it by name —
   * `Meta+Shift+l` — or empty for one grabbed as a keycode.
   */
  readonly chord: string;
  readonly keycode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** The modifiers the seat holds, already resolved against the keymap. */
export type DomicileModifiersEvent = Event & {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;

  /**
   * When the browser process received this message, on the `performance.now()`
   * clock.
   *
   * Use this, not `timeStamp`, to measure IPC latency: `timeStamp` is set in
   * the renderer at dispatch.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The answer to {@link DomicileHost.previewFile}.
 *
 * `kind` is `text`, `directory`, `audio`, `binary` or `unreadable`. Only the
 * fields for that kind are filled; the rest are empty.
 */
export type DomicileFilePreviewEvent = Event & {
  /** The path that was asked about. */
  readonly path: string;

  readonly kind: string;

  /** The start of the file, for a `text` preview. */
  readonly text: string;

  /** The first entries, for a `directory` preview. */
  readonly entries: readonly string[];

  /** Tags for an `audio` preview; empty when missing. */
  readonly title: string;
  readonly artist: string;
  readonly album: string;

  /** Length of an `audio` preview, in seconds. */
  readonly duration: number;

  /** Cover art of an `audio` preview, as a `data:` URL. */
  readonly cover: string;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** An application from a desktop entry. */
export type DomicileDesktopEntry = {
  /** The desktop file ID: its path under `applications/`, with `/` as `-`. */
  readonly id: string;

  /** `Name`, unlocalized. */
  readonly name: string;

  /** `Comment`, or empty for an entry that has none. */
  readonly comment: string;

  /**
   * `Exec` as an argv, unquoted and without field codes. Pass it to
   * {@link DomicileHost.spawn}.
   */
  readonly command: readonly string[];

  /** The entry's icon as a `data:` URL, or empty if not found. */
  readonly icon: string;

  /**
   * The `X-Domicile-Preview` image for a launcher, in the same form as
   * {@link icon}.
   */
  readonly preview: string;
};

/** A named URL from the config. */
export type DomicileBookmark = {
  /** The label a launcher shows. */
  readonly name: string;

  /** The URL. The shell opens it itself. */
  readonly url: string;

  /** The site's icon as a `data:` URL, or empty if not found. */
  readonly icon: string;
};

/** The answer to {@link DomicileHost.searchApps}, each list best first. */
export type DomicileAppsEvent = Event & {
  /** The query that was searched. */
  readonly query: string;

  readonly apps: readonly DomicileDesktopEntry[];

  readonly bookmarks: readonly DomicileBookmark[];

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** What {@link DomicileHost.searchFiles} resolves with; see {@link DomicileFilesEvent}. */
export type DomicileFileSearch = Pick<
  DomicileFilesEvent,
  "files" | "matched" | "indexing"
>;

/** What {@link DomicileHost.previewFile} resolves with; see {@link DomicileFilePreviewEvent}. */
export type DomicileFilePreview = Pick<
  DomicileFilePreviewEvent,
  | "kind"
  | "text"
  | "entries"
  | "title"
  | "artist"
  | "album"
  | "duration"
  | "cover"
>;

/** What {@link DomicileHost.searchApps} resolves with; see {@link DomicileAppsEvent}. */
export type DomicileAppSearch = Pick<DomicileAppsEvent, "apps" | "bookmarks">;

/**
 * The answer to {@link DomicileHost.searchFiles}.
 *
 * Paths are relative to the home directory and sorted; directories end in
 * `/`. Only the first matches are included. No event is sent if the home
 * cannot be read.
 */
export type DomicileFilesEvent = Event & {
  /** The query that was searched. */
  readonly query: string;

  readonly files: readonly string[];

  /** The total number of matches; {@link files} holds the first of them. */
  readonly matched: number;

  /**
   * Whether the compositor is still building the index.
   *
   * When true, the results may be incomplete. Show them and search again.
   */
  readonly indexing: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The battery state, sent whenever it changes visibly.
 *
 * Use this instead of `navigator.getBattery`, which needs UPower and reports
 * a fake full battery without it. The compositor reads
 * `/sys/class/power_supply`. Not sent on a machine with no battery.
 */
export type DomicileBatteryEvent = Event & {
  /** Charge level, 0 through 1. */
  readonly charge: number;

  /** Whether external power is connected, even when full. */
  readonly charging: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** One entry in the clipboard history. */
export type DomicileClipboardEntry = {
  /**
   * The id to pass to {@link DomicileHost.copyClipboardEntry}.
   *
   * Never reused, and stable when the list is reordered.
   */
  readonly id: number;

  /**
   * The copied text, truncated if long. Copying the entry back restores the
   * full content.
   */
  readonly preview: string;
};

/**
 * The clipboard history, newest first.
 *
 * `navigator.clipboard` only sees the browser's own clipboard, not Wayland
 * clients' copies. Sent whenever the history changes and when the page
 * connects.
 */
export type DomicileClipboardEvent = Event & {
  /** Newest first. */
  readonly entries: readonly DomicileClipboardEntry[];

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** One system tray icon. */
export type DomicileTrayItem = {
  /** The id to pass to {@link DomicileHost.activateTrayItem}. */
  readonly id: string;
  /** A text label. Never empty. */
  readonly title: string;
  /** The icon as a `data:` URL, or empty if it could not be drawn. */
  readonly icon: string;
};

/**
 * The full system tray (StatusNotifierItems on the session bus).
 *
 * Sent whenever an icon is added, removed or changed, and when the page
 * connects.
 */
export type DomicileTrayEvent = Event & {
  /** In registration order. */
  readonly items: readonly DomicileTrayItem[];

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** One button of a notification. */
export type DomicileNotificationAction = {
  /** The key to pass to {@link DomicileHost.invokeNotificationAction}. */
  readonly key: string;
  /** The button text. */
  readonly label: string;
};

/** One notification. */
export type DomicileNotification = {
  /** The id the host's dismiss and invoke calls take. */
  readonly id: number;
  /** The sender's name; may be empty. */
  readonly appName: string;
  readonly summary: string;
  /** Plain text, never markup; may be empty. */
  readonly body: string;
  /** A `data:` URL, or empty. */
  readonly icon: string;
  /** `"low"`, `"normal"` or `"critical"`. */
  readonly urgency: string;
  readonly actions: readonly DomicileNotificationAction[];
  /** Whether it offers the `"default"` action, triggered by clicking it. */
  readonly clickable: boolean;
  /**
   * Requested display time in milliseconds: `0` until dismissed, `-1` for
   * the shell's default.
   */
  readonly timeoutMs: number;
  /** Milliseconds since the epoch, on the compositor's clock. */
  readonly time: number;
};

/**
 * All uncleared notifications, oldest first.
 *
 * The compositor serves `org.freedesktop.Notifications`, which also receives
 * the page's own Web Notifications. Sent whenever the list changes and when
 * the page connects. The shell decides which are new.
 */
export type DomicileNotificationsEvent = Event & {
  /** Oldest first. */
  readonly items: readonly DomicileNotification[];

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The desktop's current light or dark theme.
 *
 * Use this instead of `prefers-color-scheme`, which does not reflect the
 * desktop's theme. The theme comes from `theme.mode` in the config and from
 * {@link DomicileHost.setTheme}. Sent to every chrome after a `setTheme`, on
 * a config reload, and when the page connects.
 */
export type DomicileThemeEvent = Event & {
  readonly theme: Theme;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Whether the desktop is idle. See `docs/IDLE.md`.
 *
 * Web idle signals such as `document.visibilityState` do not change when the
 * screens blank. Sent when the state changes and when the page connects. Not
 * sent when no idle timeout is configured.
 */
export type DomicileIdleEvent = Event & {
  /** `true` when idle, `false` when the user returns. */
  readonly idle: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Whether the desktop is locked. See `docs/LOCK.md`.
 *
 * The compositor holds the lock: while locked, it drops all input the page
 * forwards to clients. The page still gets its own keys, so it can show a lock
 * screen and call {@link DomicileHost.unlock}.
 *
 * Sent when the state changes and when the page connects, so a reloaded page
 * still shows its lock screen. Not sent when no passphrase is configured.
 */
export type DomicileLockedEvent = Event & {
  /** `true` while no input reaches any client. */
  readonly locked: boolean;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The shell config: key bindings, keymap and shell options.
 *
 * `config` is the compositor's raw JSON line; `host-message.ts` parses it.
 * Sent when the page connects and when a config reload changes it.
 */
export type DomicileShellConfigEvent = Event & {
  readonly config: string;

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A port of a device, or a profile of a card. */
export type DomicileAudioChoice = {
  readonly name: string;
  readonly description: string;
  readonly available: boolean;
};

/** An audio output or input device. */
export type DomicileAudioDevice = {
  readonly id: string;
  readonly description: string;
  readonly volume: number;
  readonly muted: boolean;
  /** Whether new streams go to it. Not `default`, a C++ keyword. */
  readonly isDefault: boolean;
  readonly monitor: boolean;
  readonly ports: readonly DomicileAudioChoice[];
  /** The port in use, or empty if none. */
  readonly port: string;
};

/** An audio playback or recording stream. */
export type DomicileAudioStream = {
  readonly id: string;
  readonly application: string;
  /** Empty if the application set none. */
  readonly title: string;
  readonly volume: number;
  readonly muted: boolean;
  /** Empty until a later event assigns the device. */
  readonly device: string;
};

/** One audio level meter reading. */
export type DomicileAudioLevel = {
  readonly id: string;
  /** Peak since the last event, 0 through 1 of full scale. */
  readonly peak: number;
};

/**
 * Levels for what {@link DomicileHost.watchAudioLevels} requested, about 20
 * times a second.
 */
export type DomicileAudioLevelsEvent = Event & {
  readonly levels: readonly DomicileAudioLevel[];
  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A sound card. */
export type DomicileAudioCard = {
  readonly id: string;
  readonly description: string;
  readonly profiles: readonly DomicileAudioChoice[];
  /** The profile in use, or empty. */
  readonly profile: string;
};

/**
 * The full audio state: devices, streams and cards, in the sound server's
 * order.
 *
 * Sent on every change and when the page connects. Not sent without a sound
 * server.
 */
export type DomicileAudioEvent = Event & {
  readonly outputs: readonly DomicileAudioDevice[];
  readonly inputs: readonly DomicileAudioDevice[];
  readonly playback: readonly DomicileAudioStream[];
  readonly recording: readonly DomicileAudioStream[];
  readonly cards: readonly DomicileAudioCard[];

  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * A browser window, drawn with `<webview window={id}>`.
 *
 * The engine holds the page, so it outlives the shell's document. After
 * `domicile load-shell` the new shell gets the same windows. See
 * docs/SHELL-BROWSER-WINDOWS.md.
 */
export type DomicileBrowserWindow = {
  /**
   * The id `<webview window>` and {@link DomicileHost.closeBrowserWindow} take.
   * Never reused while the browser runs.
   */
  readonly id: string;
  /** The page's address. Empty before the page has loaded. */
  readonly url: string;
  /** The page's title. Empty when the page has none. */
  readonly title: string;
  /**
   * The extension popup window (`chrome.windows` id) whose one tab this is.
   * `null` for an ordinary browser window.
   */
  readonly popupWindow: number | null;
  /**
   * The size the popup window asked for, in CSS pixels. 0 on an axis it left
   * unset.
   */
  readonly width: number;
  readonly height: number;
};

/**
 * One extension with an action.
 *
 * The state is the action's default (tab `-1`), not per browser window.
 */
export type DomicileExtension = {
  /** The id to pass to {@link DomicileHost.activateExtension}. */
  readonly id: string;
  readonly name: string;
  /** The action's tooltip. */
  readonly title: string;
  /**
   * A `data:image/png` URL at the page's device pixel ratio. Not a
   * `chrome-extension://` URL, because icons set with
   * `action.setIcon({imageData})` have none.
   */
  readonly icon: string;
  readonly badgeText: string;
  /** A CSS color, `#rrggbbaa`; transparent when the extension set none. */
  readonly badgeColor: string;
  /**
   * The popup to open in a `<webview>` on click, or `null` when the click
   * fires `action.onClicked`. Either way, call
   * {@link DomicileHost.activateExtension}.
   */
  readonly popup: string | null;
  /** `false` after `action.disable()`. */
  readonly enabled: boolean;
};

/**
 * All extensions with an action, sent on any change and when the page
 * connects.
 *
 * No `arrival`: this comes from the browser process, not the compositor.
 */
export type DomicileExtensionsEvent = Event & {
  readonly extensions: readonly DomicileExtension[];
};

/** Every event `window.domicile` fires, by name. */
export type DomicileHostEventMap = {
  appappeared: DomicileAppEvent;
  appresized: DomicileAppEvent;
  /**
   * The window's minimum size from xdg-shell's `set_min_size`. `0` means no
   * limit on that axis.
   */
  appminsize: DomicileAppEvent;
  /** The maximum size, like {@link DomicileHostEventMap.appminsize}. */
  appmaxsize: DomicileAppEvent;
  /**
   * A client opened or moved a popup. See `popup_placed` in
   * `domicile-protocol`.
   */
  popupplaced: DomicileAppEvent;
  appclosed: DomicileAppEvent;
  appcursor: DomicileAppCursorEvent;
  focuschanged: DomicileAppEvent;
  /**
   * A client asked for keyboard focus. Focus has not moved; the shell may call
   * `focusApp()`. See `focus_requested` in `domicile-protocol`.
   */
  focusrequested: DomicileAppEvent;
  apptitled: DomicileAppTitledEvent;
  shortcut: DomicileShortcutEvent;
  modifiers: DomicileModifiersEvent;
  /** The answer to {@link DomicileHost.searchFiles}. */
  files: DomicileFilesEvent;
  /** The answer to {@link DomicileHost.previewFile}. */
  filepreview: DomicileFilePreviewEvent;
  /** The answer to {@link DomicileHost.searchApps}. */
  apps: DomicileAppsEvent;
  /** The battery state, on change. */
  battery: DomicileBatteryEvent;
  /** The clipboard history, on change. */
  clipboard: DomicileClipboardEvent;
  /** The desktop theme, on change. See {@link DomicileHost.setTheme}. */
  theme: DomicileThemeEvent;
  /** The idle state, on change and on connect. */
  idle: DomicileIdleEvent;
  /** The lock state, on change and on connect. */
  locked: DomicileLockedEvent;
  /**
   * The client windows' theme, after they repaint and on connect. See
   * {@link DomicileHost.themeCaptured}.
   */
  windowstheme: DomicileThemeEvent;
  /** The shell config, on connect and when a reload changes it. */
  shellconfig: DomicileShellConfigEvent;
  audio: DomicileAudioEvent;
  audiolevels: DomicileAudioLevelsEvent;
  /** All extensions with an action, on change and on connect. */
  extensions: DomicileExtensionsEvent;
  /** The full system tray, on change and on connect. */
  tray: DomicileTrayEvent;
  /** All notifications, on change and on connect. */
  notifications: DomicileNotificationsEvent;
  /**
   * An answer to {@link DomicileHost.callSystem}: `data` is the compositor's
   * `system_reply`, `system_event` or `system_end` line. See the `system`
   * module.
   */
  system: MessageEvent<string>;
  /**
   * A screen was added, removed, resized or rescaled. Read
   * {@link DomicileHost.displays} for the new state.
   */
  displayschanged: Event;
  /**
   * The brightness changed. Read {@link DomicileHost.brightness} for the new
   * value.
   */
  brightnesschanged: Event;
  /**
   * A browser window opened, closed, navigated or changed title. Read
   * {@link DomicileHost.browserWindows} for the new list.
   */
  browserwindowschanged: Event;

  /**
   * A window appeared, closed, or changed. Bare — read
   * {@link DomicileHost.windows} for what they are now.
   */
  windowschanged: Event;
  /**
   * The compositor said where the keyboard is. Bare — read
   * {@link DomicileHost.focusedWindow}. Every time, not only when it moves, and
   * once after the windows already running are replayed to a page that has
   * just connected: a window listed after the first of these is one opened
   * now.
   */
  focusedwindowchanged: Event;
  /** Bare: the attribute it names moved. */
  clipboardchanged: Event;
  /** Bare: the attribute it names moved. */
  traychanged: Event;
  /** Bare: the attribute it names moved. */
  notificationschanged: Event;
  /** Bare: the attribute it names moved. */
  extensionschanged: Event;
  /** Bare: the attributes it names moved. */
  audiochanged: Event;
  /** Bare: the attributes it names moved. */
  batterychanged: Event;
  /** Bare: the attribute it names moved. */
  idlechanged: Event;
  /** Bare: the attribute it names moved. */
  lockedchanged: Event;
  /** Bare: the attribute it names moved. */
  themechanged: Event;
  /** Bare: the attribute it names moved. */
  windowsthemechanged: Event;
  /** Bare: the attributes it names moved. */
  modifierschanged: Event;
};

/**
 * The shell's control channel to the compositor.
 *
 * In the IDL this is an `EventTarget`. The first `addEventListener` binds the
 * channel, so nothing is dispatched before something listens.
 *
 * It is not typed as `EventTarget` here: that would add `lib.dom`'s overload
 * and type listeners as plain `Event`. As a result, an `EventTarget` does not
 * satisfy this type, so test doubles register listeners themselves.
 */
export type DomicileHost = {
  /**
   * Run a command on the desktop's machine.
   *
   * Takes an argv array because no shell parses it. Throws if empty.
   */
  spawn(command: readonly string[]): void;

  /**
   * Search the home directory for `query`. Resolves with the result, which
   * also arrives as a `files` event. A newer call rejects this one with an
   * `AbortError`.
   *
   * It takes no path on purpose, so pages cannot browse the filesystem. The
   * compositor matches against its index and sends only the matches. See
   * `domicile_host::file_search`.
   */
  searchFiles(query: string): Promise<DomicileFileSearch>;

  /**
   * Preview `path`. Resolves with the result, which also arrives as a
   * `filepreview` event. A newer call rejects this one, as with
   * {@link searchFiles}.
   *
   * Paths outside the compositor's home index are `unreadable`, so a page can
   * only read what a search could return. See `domicile_host::file_preview`.
   */
  previewFile(path: string): Promise<DomicileFilePreview>;

  /**
   * Search installed applications and bookmarks for `query`. Resolves with
   * the result, which also arrives as an `apps` event. A newer call rejects
   * this one, as with {@link searchFiles}. See `domicile_host::desktop_entries`.
   */
  searchApps(query: string): Promise<DomicileAppSearch>;

  /**
   * A system call: `request` is the call as JSON, answered with `system`
   * events carrying `id`. The compositor checks every call, the lock
   * included. Use the `system` module rather than calling this. See
   * `docs/architecture/SYSTEM-ACCESS.md`.
   */
  callSystem(id: number, request: string): void;

  /**
   * Put a clipboard history entry back on the clipboard.
   *
   * Takes an id from the last `clipboard` event, not text, so a page cannot
   * write arbitrary data to the clipboard. The compositor then serves the
   * entry, even if the client that copied it has exited.
   */
  copyClipboardEntry(entry: number): void;

  /**
   * Move the compositor's keyboard focus. Shells call the SDK's `focusApp` and
   * `focusChrome` instead.
   */
  focusApp(appId: string): void;
  focusChrome(): void;

  /**
   * Move the pointer to `x`, `y` in page coordinates (`clientX`/`clientY`).
   *
   * Handled by the engine, which draws the cursor. Does nothing when nested in
   * another compositor.
   */
  warpPointer(x: number, y: number): void;

  /** Ask a client to close. It may refuse, for example to offer a save. */
  closeApp(appId: string): void;

  /**
   * Report where the page put an `<app>`, in page CSS pixels. The client draws
   * at the scale of the monitor holding most of that box.
   */
  setAppBounds(
    appId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;

  /**
   * Set the desktop theme.
   *
   * Answered with a `theme` event to every chrome, including this one, so
   * render from the event. The compositor also serves the theme to clients
   * through the settings portal. Not saved to the config.
   */
  setTheme(theme: Theme): void;

  /**
   * Try to unlock the desktop with `passphrase`.
   *
   * Answered with a `locked` event to every chrome. Hide the lock screen only
   * when that event says unlocked. A wrong passphrase sends `locked: true`.
   * There is no retry limit or delay yet.
   */
  unlock(passphrase: string): void;

  /**
   * Lock the desktop now.
   *
   * Answered with a `locked` event to every chrome. Does nothing when no lock
   * is configured.
   */
  lock(): void;

  /**
   * Set the backlight to `level`, 0 through 1.
   *
   * Answered with `brightnesschanged` to every chrome. The compositor never
   * turns the screen fully off. Throws if `level` is not a number.
   */
  setBrightness(level: number): void;

  /**
   * Mixer controls. Ids come from the last `audio` event; volume is a fraction
   * of the sound server's 100%.
   *
   * Answered with the next `audio` event to every chrome. Unknown ids are
   * logged and ignored.
   */
  setAudioVolume(id: string, volume: number): void;
  setAudioMuted(id: string, muted: boolean): void;
  setDefaultAudioDevice(id: string): void;
  moveAudioStream(id: string, device: string): void;
  setAudioPort(id: string, port: string): void;
  setAudioProfile(card: string, profile: string): void;

  /**
   * Meter these devices and streams (ids from an `audio` event) and fire
   * `audiolevels`.
   *
   * This is a lease: call it again every second while the meters are visible.
   * The compositor stops metering anything not renewed, because metering a
   * microphone records it. An empty list stops at once.
   */
  watchAudioLevels(ids: readonly string[]): void;

  /**
   * Tell the compositor this page has captured its old frame for a `theme`
   * transition, so client windows can switch theme now.
   *
   * The windows must switch after the capture and before the transition
   * starts. The compositor waits for every chrome (with a timeout), updates
   * the windows, and sends `windowstheme` once they repaint.
   */
  themeCaptured(theme: Theme): void;

  /**
   * Route a key combination to the page instead of the focused client.
   *
   * By name (`grabShortcut("Meta+Shift+l")`, sway's grammar), the engine finds
   * the key the keysym is on, and again on layout change. Presses arrive as
   * `shortcut` events whose `chord` is this string, from a `<webview>` or this
   * page (taken from the page).
   *
   * As a {@link DomicileShortcut}, presses arrive with the same fields and an
   * empty `chord`.
   *
   * @throws `SyntaxError` for a malformed chord; `NotFoundError` for a keysym
   *   the keyboard cannot type, once the compositor has described it.
   */
  grabShortcut(shortcut: string | DomicileShortcut): void;

  /**
   * Click an extension's action: grants `activeTab` on the active tab, and
   * fires `action.onClicked` if there is no popup. The shell opens any popup
   * itself, in a `<webview>` at {@link DomicileExtension.popup}.
   */
  activateExtension(id: string): void;

  /**
   * Opens a browser window at `url`, for the shell's own UI such as a `+`
   * button. It appears in the next `browserwindowschanged`. Windows that
   * programs open (`domicile open-url`, `target="_blank"`, extensions) arrive
   * the same way.
   */
  openBrowserWindow(url: string): void;

  /**
   * Closes browser window `id`. It leaves the next `browserwindowschanged`.
   * Does nothing for an unknown id.
   */
  closeBrowserWindow(id: string): void;

  /**
   * Click a system tray icon with the button `action` names. Does nothing if
   * the application has exited. Throws on an empty id.
   */
  activateTrayItem(id: string, action: TrayAction): void;

  /**
   * Dismiss notifications by id and tell their applications. Unknown ids are
   * ignored.
   */
  dismissNotifications(ids: readonly number[]): void;

  /**
   * Invoke a notification's action (`"default"` for clicking it), then close
   * it. Unknown actions are ignored.
   */
  invokeNotificationAction(id: number, action: string): void;

  key(appId: string, keycode: number, pressed: boolean): void;
  pointerMotion(appId: string, x: number, y: number): void;
  pointerLeave(appId: string): void;
  pointerButton(appId: string, button: number, pressed: boolean): void;
  pointerAxis(
    appId: string,
    dx: number,
    dy: number,
    v120X: number,
    v120Y: number,
  ): void;

  /**
   * The desktop's screens.
   *
   * An attribute so components that mount late can read it. `null` until the
   * compositor reports, which differs from an empty array (no screens). A new
   * frozen array after each `displayschanged`.
   */
  readonly displays: readonly DomicileDisplay[] | null;

  /**
   * The backlight level, 0 through 1. `null` until the compositor reports,
   * and always on a machine with no backlight.
   */
  readonly brightness: number | null;

  /**
   * The browser windows, oldest first.
   *
   * An attribute so components that mount late can read it. `null` until the
   * browser lists them, which it does as soon as something listens.
   */
  readonly browserWindows: readonly DomicileBrowserWindow[] | null;

  /**
   * Every client window, in the order they appeared. Reading it binds the
   * channel, and the compositor announces the windows already running as it
   * does, so a shell that reads late misses nothing: read, then listen for
   * `windowschanged`. A different frozen array after every change.
   */
  readonly windows: readonly DomicileWindow[];

  /** The window holding the keyboard, or `null` when the shell's page holds it. */
  readonly focusedWindow: string | null;

  // THE DESK'S STATE. Each is what the compositor last said, `null` until it
  // has said anything; a bare `<name>changed` says it moved.
  readonly clipboard: readonly DomicileClipboardEntry[] | null;
  readonly tray: readonly DomicileTrayItem[] | null;
  readonly notifications: readonly DomicileNotification[] | null;
  readonly extensions: readonly DomicileExtension[] | null;
  readonly audioOutputs: readonly DomicileAudioDevice[] | null;
  readonly audioInputs: readonly DomicileAudioDevice[] | null;
  readonly audioPlayback: readonly DomicileAudioStream[] | null;
  readonly audioRecording: readonly DomicileAudioStream[] | null;
  readonly audioCards: readonly DomicileAudioCard[] | null;
  readonly batteryCharge: number | null;
  readonly batteryCharging: boolean | null;
  readonly idle: boolean | null;
  readonly locked: boolean | null;
  readonly theme: Theme | null;
  readonly windowsTheme: Theme | null;
  /** The compositor seat's — see the README before trusting them. */
  readonly altKey: boolean | null;
  readonly ctrlKey: boolean | null;
  readonly shiftKey: boolean | null;
  readonly metaKey: boolean | null;

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void;
};

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface Window {
    /**
     * The compositor host for this page. Shells use this spelling.
     *
     * The same object as {@link Navigator.domicile}. Absent on a stock
     * browser, and `null` for a document with no frame.
     */
    readonly domicile?: DomicileHost | null;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface Navigator {
    /** The same object as {@link Window.domicile}. */
    readonly domicile?: DomicileHost | null;
  }
}
