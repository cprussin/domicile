// The messages `DomicileClient.on` delivers to a shell, and the translators
// that build them from `window.domicile` events.
//
// The engine's events are shaped for WebIDL (empty strings for absence,
// `hasSize` flags). The translators turn them into plain payloads.
// `domicile-client.ts` calls one per listener.
//
// Message names match the compositor's protocol names (`app_appeared`, not
// `appappeared`), so logs and shell code use the same word. The event type is
// the key in {@link HostMessageMap}, so payloads carry no `type` field.

import { z } from "zod";

import type { AudioCard, AudioChoice, AudioDevice, AudioStream } from "./audio";
import type { CursorShape } from "./cursor-shape";
import { cursorShapeSchema } from "./cursor-shape";
import type {
  DomicileAppCursorEvent,
  DomicileAppEvent,
  DomicileAppsEvent,
  DomicileAppTitledEvent,
  DomicileAudioChoice,
  DomicileAudioDevice,
  DomicileAudioEvent,
  DomicileAudioLevelsEvent,
  DomicileAudioStream,
  DomicileBatteryEvent,
  DomicileBrowserWindow,
  DomicileClipboardEntry,
  DomicileClipboardEvent,
  DomicileDisplay,
  DomicileExtensionsEvent,
  DomicileFilePreviewEvent,
  DomicileFilesEvent,
  DomicileIdleEvent,
  DomicileLockedEvent,
  DomicileModifiersEvent,
  DomicileNotificationsEvent,
  DomicileShellConfigEvent,
  DomicileShortcutEvent,
  DomicileThemeEvent,
  DomicileTrayEvent,
} from "./domicile-host";
import type { Extension } from "./extension";
import { extensionSchema } from "./extension";
import {
  FilePreview,
  FilePreviewKind,
  filePreviewKindSchema,
} from "./file-preview";
import type { KeyAction } from "./key-action";
import type { Notification } from "./notification";
import { notificationUrgencySchema } from "./notification";
import { shellConfigSchema } from "./protocol";
import type { Theme } from "./theme";
import type { TrayItem } from "./tray";

/**
 * A window exists.
 *
 * The compositor replays every open window when a chrome connects, so this can
 * repeat for a window the page already has. Key windows by app id.
 */
export type AppAppearedMessage = {
  app_id: string;
  /**
   * `undefined` until the client draws its first buffer; the size arrives in
   * the following `app_resized`. Until then the chrome picks a size itself.
   */
  size: readonly [width: number, height: number] | undefined;
  title: string | undefined;
};

/**
 * A client set its window's title.
 *
 * `undefined` covers both "no title yet" and `set_title("")`; xdg-shell has no
 * request to clear a title.
 */
export type AppTitledMessage = {
  app_id: string;
  title: string | undefined;
};

export type AppResizedMessage = {
  app_id: string;
  size: readonly [width: number, height: number];
};

/**
 * A client's minimum or maximum window size per axis; `undefined` means no
 * limit on that axis.
 *
 * A box outside the limits gets a frame that is cropped or stretched, so a
 * shell should size windows within them.
 */
export type AppSizeLimitMessage = {
  app_id: string;
  size: readonly [width: number | undefined, height: number | undefined];
};

/**
 * A client opened or moved a popup (a menu or tooltip).
 *
 * The shell places it as its own `<app>`: `size` at `position` relative to
 * `parent` (a window or popup, always announced first). It closes with
 * `app_closed`. It is not a window and is not tiled; for keyboard focus it
 * belongs to its window (see {@link DomicileClient.windowOf}). The compositor
 * dismisses a `grab` popup when the keyboard leaves its window.
 */
export type PopupPlacedMessage = {
  app_id: string;
  grab: boolean;
  parent: string;
  position: readonly [x: number, y: number];
  size: readonly [width: number, height: number];
};

export type AppClosedMessage = {
  app_id: string;
};

export type AppCursorMessage = {
  app_id: string;
  cursor: CursorShape;
};

/**
 * Which window has keyboard focus; `undefined` means the chrome has it.
 *
 * Focus also moves without `focusApp` (clicks, closed clients), so track this
 * rather than your own requests.
 */
export type FocusChangedMessage = {
  app_id: string | undefined;
};

/**
 * A client asked for keyboard focus.
 *
 * Focus does not move until the shell calls `focusApp`; ignoring the request
 * is a valid policy. {@link FocusChangedMessage} reports actual changes.
 */
export type FocusRequestedMessage = {
  app_id: string;
};

/**
 * A shortcut the chrome grabbed was pressed.
 *
 * Same shape `grabShortcut` takes (see `DomicileShortcut`), so a shell can
 * compare the two directly.
 */
export type ShortcutMessage = {
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * Which modifiers are held, sent on each change.
 *
 * The page cannot see modifiers while a window has focus, but needs them for
 * gestures like alt-drag. The compositor has already resolved xkb state, so
 * these are plain booleans.
 */
export type ModifiersMessage = {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * The current displays, sent when they change.
 *
 * The engine's `displayschanged` event has no payload; the client attaches
 * `window.domicile.displays`. To read them without waiting for a change, use
 * {@link DomicileClient.displays}.
 */
export type DisplaysMessage = {
  displays: readonly DomicileDisplay[];
};

/**
 * The reply to {@link DomicileClient.searchFiles}.
 *
 * `files` holds the top matches in display order, as paths relative to the
 * home directory; directories end in `/`. `matched` is the total count.
 */
export type FoundFilesMessage = {
  /** The query this answers. */
  query: string;
  files: readonly string[];
  matched: number;
  /**
   * Whether the index is still being built, so the results may be incomplete.
   * Show that to the user and search again later.
   */
  indexing: boolean;
};

/**
 * The reply to {@link DomicileClient.searchApps}: matching applications and
 * bookmarks, best first.
 */
export type FoundAppsMessage = {
  /** The query this answers. */
  query: string;
  apps: readonly DesktopEntry[];
  bookmarks: readonly Bookmark[];
};

/** A configured bookmark; the shell opens it itself. */
export type Bookmark = {
  name: string;
  url: string;
  /** The site's icon as a `data:` URL, or `undefined` if none was found. */
  icon: string | undefined;
};

/** An application from a desktop entry, for a launcher. */
export type DesktopEntry = {
  id: string;
  name: string;
  /** Empty if the entry has none. */
  comment: string;
  /** The argv, for {@link DomicileClient.spawn}. */
  command: readonly string[];
  /** A `data:` URL, or `undefined` if no icon was found. */
  icon: string | undefined;
  /** A preview image, as a `data:` URL or `undefined`. */
  preview: string | undefined;
};

/** The reply to {@link DomicileClient.previewFile}. */
export type FilePreviewMessage = {
  /** The path this answers. */
  path: string;
  preview: FilePreview;
};

/**
 * The battery state, sent on connect and when it changes visibly.
 *
 * A machine with no battery never sends this. `charge` is 0 through 1.
 * `charging` means AC is connected, so it is `true` on a full battery too.
 */
export type BatteryMessage = {
  charge: number;
  charging: boolean;
};

/**
 * Screen brightness, 0 through 1. Never sent on a machine with no backlight.
 */
export type BrightnessMessage = {
  level: number;
};

/**
 * The clipboard history, newest first, sent on connect and on each change.
 *
 * The history lives in memory only. Each row is an id and a preview. The
 * compositor keeps the copied data, so the page never holds it. Call
 * `copyClipboardEntry` with an id to restore one.
 */
export type ClipboardMessage = {
  entries: readonly DomicileClipboardEntry[];
};

/**
 * The desktop's light or dark theme, sent on connect and on each change.
 *
 * `setTheme` triggers this on every chrome, not just the caller. Use this
 * rather than `prefers-color-scheme`; see `theme.ts`.
 */
export type ThemeMessage = {
  theme: Theme;
};

/**
 * Whether the desktop is idle, sent on connect and on each change.
 *
 * The screens blank at the same moment, so there is no time to show a warning.
 * Use it to prepare what shows when the screens wake. Idle is separate from
 * {@link LockedMessage}. A desktop with no idle timeout never sends this. See
 * `docs/SHELL-IDLE-AND-LOCK.md`.
 */
export type IdleMessage = {
  idle: boolean;
};

/**
 * Whether the desktop is locked, sent on connect and on each change.
 *
 * While locked, the compositor delivers no input to clients. The page still
 * gets its own input, so it can show a lock screen and call `unlock` with the
 * passphrase. Reloading the page or restarting the engine does not unlock. A
 * desktop with no passphrase never sends this. See
 * `docs/SHELL-IDLE-AND-LOCK.md`.
 */
export type LockedMessage = {
  locked: boolean;
};

/**
 * The extensions that have an action, sent in full on connect and on each
 * change.
 *
 * Each action shows its default state; per-window state is not supported yet.
 * On click, call `activateExtension(id)` and open a `<webview>` at `popup` if
 * set.
 */
export type ExtensionsMessage = {
  extensions: readonly Extension[];
};

/**
 * The system tray items, sent in full on connect and on each change.
 *
 * On click, call `activateTrayItem(id, action)`.
 */
export type TrayMessage = {
  items: readonly TrayItem[];
};

/** A shell keybinding: a chord and its action. */
export type Keybinding = {
  /** In the form `grabShortcut` takes. */
  shortcut: ShortcutMessage;
  action: KeyAction;
};

/**
 * Keybindings by mode name. `default` is always present, possibly empty.
 *
 * A `Map` because mode names are user input and could clash with object
 * properties like `constructor`.
 */
export type KeybindingsByMode = ReadonlyMap<string, readonly Keybinding[]>;

/**
 * The keyboard layout: each keysym name mapped to its evdev keycode, for
 * resolving a shell's chords. Sent on connect and when a config reload
 * changes the layout.
 */
export type ShellConfigMessage = {
  keys: ReadonlyMap<string, number>;
};

/**
 * The notifications, oldest first, sent in full on connect and on each
 * change.
 *
 * Clear with `dismissNotifications(ids)`; run an action with
 * `invokeNotificationAction(id, action)`.
 */
export type NotificationsMessage = {
  items: readonly Notification[];
};

/**
 * Every browser window, sent in full when the shell starts listening and on
 * each change. After `domicile load-shell` it holds the previous shell's
 * windows.
 */
export type BrowserWindowsMessage = {
  windows: readonly DomicileBrowserWindow[];
};

/**
 * The audio devices, streams and cards, in the sound server's order. Sent in
 * full on connect and on each change.
 *
 * Never sent without a sound server. Output monitors appear in `inputs` with
 * `monitor` set.
 */
export type AudioMessage = {
  outputs: readonly AudioDevice[];
  inputs: readonly AudioDevice[];
  playback: readonly AudioStream[];
  recording: readonly AudioStream[];
  cards: readonly AudioCard[];
};

/**
 * Peak level by device or stream id since the last message, 0 through 1.
 * Sent only for ids passed to `watchAudioLevels`, while the watch is renewed.
 */
export type AudioLevelsMessage = {
  levels: ReadonlyMap<string, number>;
};

/** Every message the client delivers, and what each one carries. */
export type HostMessageMap = {
  app_appeared: AppAppearedMessage;
  app_titled: AppTitledMessage;
  app_resized: AppResizedMessage;
  app_min_size: AppSizeLimitMessage;
  app_max_size: AppSizeLimitMessage;
  popup_placed: PopupPlacedMessage;
  app_closed: AppClosedMessage;
  app_cursor: AppCursorMessage;
  focus_changed: FocusChangedMessage;
  focus_requested: FocusRequestedMessage;
  shortcut: ShortcutMessage;
  modifiers: ModifiersMessage;
  displays: DisplaysMessage;
  battery: BatteryMessage;
  brightness: BrightnessMessage;
  audio: AudioMessage;
  audio_levels: AudioLevelsMessage;
  clipboard: ClipboardMessage;
  theme: ThemeMessage;
  idle: IdleMessage;
  locked: LockedMessage;
  extensions: ExtensionsMessage;
  tray: TrayMessage;
  notifications: NotificationsMessage;
  browser_windows: BrowserWindowsMessage;
  /**
   * The windows' theme, sent once they have switched after `theme`. See
   * {@link DomicileHost.themeCaptured}.
   */
  windows_theme: ThemeMessage;
  shell_config: ShellConfigMessage;
};

/** The name of every message. */
export type HostMessageType = keyof HostMessageMap;

/** Narrow a message to one variant, for a handler signature. */
export type HostMessageOf<T extends HostMessageType> = HostMessageMap[T];

/**
 * Translates an `appappeared` event.
 *
 * The translators are pure functions, not inline listener code, so tests can
 * assert on them; a throw inside a DOM listener goes to the page's error
 * handler instead.
 */
export const appAppeared = (event: DomicileAppEvent): AppAppearedMessage => ({
  app_id: event.appId,
  // Use `hasSize`, not a zero test: zero is a valid size, and the engine also
  // sends zeros when there is no size yet.
  size: event.hasSize ? [event.width, event.height] : undefined,
  title: named(event.title),
});

export const appTitled = (event: DomicileAppTitledEvent): AppTitledMessage => ({
  app_id: event.appId,
  title: named(event.title),
});

export const appResized = (event: DomicileAppEvent): AppResizedMessage => ({
  app_id: event.appId,
  // A resize always carries a size. Values may be fractional CSS pixels.
  size: [event.width, event.height],
});

export const appSizeLimit = (event: DomicileAppEvent): AppSizeLimitMessage => ({
  app_id: event.appId,
  // In xdg-shell, zero means no limit.
  size: [limit(event.width), limit(event.height)],
});

export const popupPlaced = (event: DomicileAppEvent): PopupPlacedMessage => ({
  app_id: event.appId,
  grab: event.grab,
  parent: event.parentAppId,
  position: [event.x, event.y],
  size: [event.width, event.height],
});

export const appClosed = (event: DomicileAppEvent): AppClosedMessage => ({
  app_id: event.appId,
});

/**
 * Translates a cursor change over a window.
 *
 * Parsed because the SDK and engine ship separately and may disagree on the
 * set of shapes. An unknown CSS cursor keyword fails silently, so throw here
 * instead.
 */
export const appCursor = (event: DomicileAppCursorEvent): AppCursorMessage => ({
  app_id: event.appId,
  cursor: cursorShapeSchema.parse(event.cursor),
});

export const focusChanged = (event: DomicileAppEvent): FocusChangedMessage => ({
  app_id: named(event.appId),
});

export const focusRequested = (
  event: DomicileAppEvent,
): FocusRequestedMessage => ({
  app_id: event.appId,
});

export const shortcut = (event: DomicileShortcutEvent): ShortcutMessage => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  keycode: event.keycode,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});

/** Translates a file search reply. A plain copy that drops `arrival`. */
export const foundFiles = (event: DomicileFilesEvent): FoundFilesMessage => ({
  files: event.files,
  indexing: event.indexing,
  matched: event.matched,
  query: event.query,
});

/** Translates an app search reply; empty icons become `undefined`. */
export const foundApps = (event: DomicileAppsEvent): FoundAppsMessage => ({
  apps: event.apps.map((entry) => ({
    command: entry.command,
    comment: entry.comment,
    icon: named(entry.icon),
    id: entry.id,
    name: entry.name,
    preview: named(entry.preview),
  })),
  bookmarks: event.bookmarks.map((bookmark) => ({
    icon: named(bookmark.icon),
    name: bookmark.name,
    url: bookmark.url,
  })),
  query: event.query,
});

/**
 * Translates a file preview reply.
 *
 * `kind` is parsed, as in `appCursor`, so an unknown kind throws instead of
 * showing an empty preview.
 */
export const filePreview = (
  event: DomicileFilePreviewEvent,
): FilePreviewMessage => ({
  path: event.path,
  preview: previewOf(event),
});

/** Builds the preview for `event`'s kind. */
const previewOf = (event: DomicileFilePreviewEvent): FilePreview => {
  const kind = filePreviewKindSchema.parse(event.kind);
  switch (kind) {
    case FilePreviewKind.Text: {
      return FilePreview.Text(event.text);
    }
    case FilePreviewKind.Directory: {
      return FilePreview.Directory(event.entries);
    }
    case FilePreviewKind.Audio: {
      return FilePreview.Audio({
        album: said(event.album),
        artist: said(event.artist),
        cover: said(event.cover),
        duration: event.duration,
        title: said(event.title),
      });
    }
    case FilePreviewKind.Binary: {
      return FilePreview.Binary();
    }
    case FilePreviewKind.Unreadable: {
      return FilePreview.Unreadable();
    }
  }
};

/** An audio tag; the engine sends an empty string for a missing one. */
const said = (tag: string): string | undefined =>
  tag === "" ? undefined : tag;

/** Translates a battery event, dropping `arrival`. */
export const battery = (event: DomicileBatteryEvent): BatteryMessage => ({
  charge: event.charge,
  charging: event.charging,
});

/** Translates a clipboard event, dropping `arrival`. */
export const clipboard = (event: DomicileClipboardEvent): ClipboardMessage => ({
  entries: event.entries,
});

/**
 * Translates a theme event, dropping `arrival`.
 *
 * Not parsed: the bindings already reject values outside `DomicileTheme`.
 */
export const theme = (event: DomicileThemeEvent): ThemeMessage => ({
  theme: event.theme,
});

/** Translates an idle event, dropping `arrival`. */
export const idle = (event: DomicileIdleEvent): IdleMessage => ({
  idle: event.idle,
});

/** Translates a lock event, dropping `arrival`. */
export const locked = (event: DomicileLockedEvent): LockedMessage => ({
  locked: event.locked,
});

/**
 * Translates an extensions event.
 *
 * Parsed, as in `appCursor`, so a row the SDK cannot use (a non-PNG icon, a
 * bad id) throws instead of drawing a dead button. Also turns a `null` popup
 * into `undefined`.
 */
export const extensions = (
  event: DomicileExtensionsEvent,
): ExtensionsMessage => ({
  extensions: z.array(extensionSchema).parse(event.extensions),
});

/** Translates a tray event; empty icons become `undefined`. */
export const tray = (event: DomicileTrayEvent): TrayMessage => ({
  items: event.items.map((item) => ({
    icon: named(item.icon),
    id: item.id,
    title: item.title,
  })),
});

/**
 * Translates a shell config event by parsing its JSON.
 *
 * The engine forwards the compositor's JSON unparsed; see
 * {@link DomicileShellConfigEvent}.
 */
export const shellConfig = (
  event: DomicileShellConfigEvent,
): ShellConfigMessage => {
  const config = shellConfigSchema.parse(JSON.parse(event.config));
  return { keys: new Map(Object.entries(config.keys)) };
};

/**
 * Translates an audio event. Empty strings become `undefined`, and
 * `isDefault` becomes `default` (a reserved word in C++).
 */
export const audio = (event: DomicileAudioEvent): AudioMessage => ({
  cards: event.cards.map((card) => ({
    description: card.description,
    id: card.id,
    profile: named(card.profile),
    profiles: card.profiles.map(choice),
  })),
  inputs: event.inputs.map(device),
  outputs: event.outputs.map(device),
  playback: event.playback.map(stream),
  recording: event.recording.map(stream),
});

export const audioLevels = (
  event: DomicileAudioLevelsEvent,
): AudioLevelsMessage => ({
  levels: new Map(event.levels.map(({ id, peak }) => [id, peak])),
});

const choice = ({
  available,
  description,
  name,
}: DomicileAudioChoice): AudioChoice => ({ available, description, name });

const device = (engine: DomicileAudioDevice): AudioDevice => ({
  default: engine.isDefault,
  description: engine.description,
  id: engine.id,
  monitor: engine.monitor,
  muted: engine.muted,
  port: named(engine.port),
  ports: engine.ports.map(choice),
  volume: engine.volume,
});

const stream = (engine: DomicileAudioStream): AudioStream => ({
  application: engine.application,
  device: named(engine.device),
  id: engine.id,
  muted: engine.muted,
  title: named(engine.title),
  volume: engine.volume,
});

/**
 * Translates a notifications event.
 *
 * Empty icons become `undefined`, and a negative timeout becomes `undefined`
 * (the shell decides). Urgency is parsed so an unknown value throws.
 */
export const notifications = (
  event: DomicileNotificationsEvent,
): NotificationsMessage => ({
  items: event.items.map((item) => ({
    actions: item.actions.map(({ key, label }) => ({ key, label })),
    appName: item.appName,
    body: item.body,
    clickable: item.clickable,
    icon: named(item.icon),
    id: item.id,
    summary: item.summary,
    time: item.time,
    timeoutMs: item.timeoutMs < 0 ? undefined : item.timeoutMs,
    urgency: notificationUrgencySchema.parse(item.urgency),
  })),
});

export const modifiers = (event: DomicileModifiersEvent): ModifiersMessage => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});

/** Maps the engine's empty `DOMString` to `undefined`. */
const named = (value: string): string | undefined =>
  value === "" ? undefined : value;

/** One axis of a size limit; xdg-shell's `0` means no limit. */
const limit = (pixels: number): number | undefined =>
  pixels === 0 ? undefined : pixels;
