// Zod schemas for the compositor's JSON wire, mirroring the Rust
// `domicile-protocol` crate. Host frames are untrusted, so they are parsed, not
// cast.
//
// Pages get typed attributes and events on the `DomicileHost` a shell is
// handed instead. These schemas serve `@domicile-desktop/e2e-harness`, which
// reads the compositor's socket directly.
//
// `wire-fixture.test.ts` checks that these schemas accept what Rust writes.
// Schemas ignore unknown keys so a newer host can add fields.

import { cursorShapeSchema } from "@domicile-desktop/sdk/cursor-shape";
import { displayTransformSchema } from "@domicile-desktop/sdk/display-transform";
import { notificationUrgencySchema } from "@domicile-desktop/sdk/notification";
import { themeSchema } from "@domicile-desktop/sdk/theme";
import { z } from "zod";

/** The protocol version this build speaks. Must match the Rust constant. */
export const PROTOCOL_VERSION = 1;

const sizeSchema = z.tuple([z.number(), z.number()]);

/**
 * A window's title, or `undefined` when it has none.
 *
 * `null` (unset), `""` (cleared with `set_title("")`) and a missing key all
 * mean no title.
 */
const titleSchema = z
  .string()
  .nullish()
  .transform((title) => title ?? undefined)
  .transform((title) => (title === "" ? undefined : title));

const welcomeSchema = z.looseObject({
  protocol_version: z.number(),
  type: z.literal("welcome"),
});

// Can repeat for a known window: the host replays all windows to every chrome
// whenever any chrome connects. Key windows by app id.
const appAppearedSchema = z.looseObject({
  app_id: z.string(),
  // Usually absent: the client has not drawn yet. The size arrives in a later
  // `app_resized`.
  size: sizeSchema.nullish().transform((size) => size ?? undefined),
  title: titleSchema,
  type: z.literal("app_appeared"),
});

// Sent on each `set_title`. Clients usually set a title after `app_appeared`.
const appTitledSchema = z.looseObject({
  app_id: z.string(),
  title: titleSchema,
  type: z.literal("app_titled"),
});

const appResizedSchema = z.looseObject({
  app_id: z.string(),
  size: sizeSchema,
  type: z.literal("app_resized"),
});

// A client popup, placed at `position` relative to `parent`. Sent again when
// it moves; closed with `app_closed`.
const popupPlacedSchema = z.looseObject({
  app_id: z.string(),
  grab: z.boolean(),
  parent: z.string(),
  position: sizeSchema,
  size: sizeSchema,
  type: z.literal("popup_placed"),
});

// A window's size limits, as xdg-shell sends them: `0` on an axis means no
// limit.
const appMinSizeSchema = z.looseObject({
  app_id: z.string(),
  size: sizeSchema,
  type: z.literal("app_min_size"),
});

const appMaxSizeSchema = z.looseObject({
  app_id: z.string(),
  size: sizeSchema,
  type: z.literal("app_max_size"),
});

const appClosedSchema = z.looseObject({
  app_id: z.string(),
  type: z.literal("app_closed"),
});

const shortcutSchema = z.looseObject({
  alt: z.boolean(),
  ctrl: z.boolean(),
  key: z.number(),
  logo: z.boolean(),
  shift: z.boolean(),
});

// A claimed shortcut was pressed. It comes from the compositor because it must
// work while a window has keyboard focus.
const shortcutMessageSchema = z.looseObject({
  shortcut: shortcutSchema,
  type: z.literal("shortcut"),
});

// The held modifiers, sent on change. The page cannot see them while a window
// has keyboard focus, but needs them for gestures such as alt-drag.
const modifiersSchema = z.looseObject({
  alt: z.boolean(),
  ctrl: z.boolean(),
  logo: z.boolean(),
  shift: z.boolean(),
  type: z.literal("modifiers"),
});

// The window with keyboard focus. Focus also moves without `focus_app` (clicks,
// closed clients), so track this rather than your own requests.
const focusChangedSchema = z.looseObject({
  // `null` on the wire when the chrome has focus; normalized to `undefined`.
  app_id: z
    .string()
    .nullable()
    .transform((appId) => appId ?? undefined),
  type: z.literal("focus_changed"),
});

// A client requests keyboard focus. The shell grants it with `focus_app` or
// ignores it; the compositor does not decide.
const focusRequestedSchema = z.looseObject({
  app_id: z.string(),
  type: z.literal("focus_requested"),
});

// One display, in logical (CSS) pixels except `mode`. `position` is relative
// to the top-left of all displays' bounding box. See `docs/DISPLAYS.md`.
const displayInfoSchema = z.looseObject({
  // The scanout mode in physical pixels, before rotation. It cannot be derived
  // from `size` and `scale`, since `scale` is rounded to an integer.
  // Informational only; `[0, 0]` when unknown.
  mode: z
    .tuple([z.int().nonnegative(), z.int().nonnegative()])
    .nullish()
    .transform((mode) => mode ?? ([0, 0] as const)),
  // Non-empty: `<Screen name="…">` matches on it, and an empty name would
  // silently match nothing.
  name: z.string().min(1),
  // Signed, mirroring `xdg_output.logical_position`.
  position: z.tuple([z.int(), z.int()]),
  // The integer `wl_output` scale clients draw at. The chrome renders every
  // display at one `devicePixelRatio`.
  scale: z.int().positive(),
  // Integer, unlike `sizeSchema`, which holds `f64` client sizes.
  size: z.tuple([z.int().positive(), z.int().positive()]),
  // The rotation applied to content, per the `wl_output` convention. Apply it
  // as given.
  transform: displayTransformSchema
    .nullish()
    .transform((transform) => transform ?? "normal"),
});

// The desktop's displays, sent after `welcome` and on every change. The latest
// message wins; one can arrive before `welcome`, because broadcasts reach
// connections that have not finished the handshake.
//
// Never empty. When Domicile runs in a window, that window is a display named
// `domicile-0`.
const displaysSchema = z.looseObject({
  displays: z.array(displayInfoSchema),
  type: z.literal("displays"),
});

const appCursorSchema = z.looseObject({
  app_id: z.string(),
  cursor: cursorShapeSchema,
  type: z.literal("app_cursor"),
});

// The compositor's XKB keymap, in `XKB_KEYMAP_FORMAT_TEXT_V1`. The browser
// process uses it for its `KeyboardLayoutEngine`; pages do not read it.
// Non-empty, since an empty keymap types nothing.
const keymapSchema = z.looseObject({
  keymap: z.string().min(1),
  type: z.literal("keymap"),
});

// The configured Chrome extensions: Web Store ids and absolute paths to
// unpacked ones. Sent with the handshake and on config reload. The browser
// process installs them; see `docs/architecture/EXTENSIONS.md`.
const extensionsSchema = z.looseObject({
  type: z.literal("extensions"),
  unpacked: z.array(z.string()),
  web_store: z.array(z.string()),
});

// The reply to `search_files`. `files` holds the first matches, relative to
// home, in byte order, with directories ending in `/`. `matched` is the total
// count. `indexing` is true while the home directory is still being indexed.
// No reply is sent if the home directory cannot be read.
const foundFilesSchema = z.looseObject({
  files: z.array(z.string()),
  indexing: z.boolean(),
  matched: z.number().int().nonnegative(),
  query: z.string(),
  type: z.literal("found_files"),
});

// The reply to `preview_file`. `kind` says which optional fields are set;
// `binary` and `unreadable` set none.
const filePreviewSchema = z.looseObject({
  album: z.string().optional(),
  artist: z.string().optional(),
  cover: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  entries: z.array(z.string()).optional(),
  kind: z.enum(["text", "directory", "audio", "binary", "unreadable"]),
  path: z.string(),
  text: z.string().optional(),
  title: z.string().optional(),
  type: z.literal("file_preview"),
});

// Screen brightness as an unclamped fraction. Pushed on change and on
// connect. Not sent without a backlight.
const brightnessSchema = z.looseObject({
  level: z.number(),
  type: z.literal("brightness"),
});

// Clipboard history, newest first. Pushed on change and on connect.
//
// Entries carry a preview and an id, not the full text, which limits exposure
// of copied passwords. Copy one back with `copy_clipboard_entry`.
const clipboardEntrySchema = z.looseObject({
  id: z.number(),
  preview: z.string(),
});

const clipboardSchema = z.looseObject({
  entries: z.array(clipboardEntrySchema),
  type: z.literal("clipboard"),
});

// The full system tray (StatusNotifierItem), in registration order. Pushed on
// change and on connect. Activate an item with `activate_tray_item`. `icon` is
// a `data:` URL, absent when it could not be rendered.
const trayItemSchema = z.looseObject({
  icon: z.string().optional(),
  id: z.string(),
  title: z.string(),
});

const traySchema = z.looseObject({
  items: z.array(trayItemSchema),
  type: z.literal("tray"),
});

// All uncleared notifications, oldest first. Pushed on change and on connect.
// Clear with `dismiss_notifications`; press an action with
// `invoke_notification_action`. `icon` is a `data:` URL. Without
// `timeout_ms`, the shell picks the timeout. See
// `docs/architecture/NOTIFICATIONS.md`.
const notificationSchema = z.looseObject({
  actions: z.array(z.looseObject({ key: z.string(), label: z.string() })),
  app_name: z.string(),
  body: z.string(),
  clickable: z.boolean(),
  icon: z.string().optional(),
  id: z.number(),
  summary: z.string(),
  time: z.number(),
  timeout_ms: z.number().optional(),
  urgency: notificationUrgencySchema,
});

const notificationsSchema = z.looseObject({
  items: z.array(notificationSchema),
  type: z.literal("notifications"),
});

// The desktop's light or dark theme. Sent with the handshake, after any
// `setTheme` (to every chrome) and on config reload.
//
// Required, with no default: a wrong default would repaint the desktop in the
// wrong theme.
const themeMessageSchema = z.looseObject({
  theme: themeSchema,
  type: z.literal("theme"),
});

// Whether the desktop is idle: `true` after `idle.blank_after_seconds` with no
// input, `false` on activity. Sent on change and on connect, so a reloaded
// page learns the current state.
//
// `true` arrives as the screens blank, so use it to prepare what shows on
// wake. Not sent when blanking is disabled. See `docs/IDLE.md`.
const idleSchema = z.looseObject({
  // Required: defaulting to `false` could dismiss a lock screen.
  idle: z.boolean(),
  type: z.literal("idle"),
});

// Whether the desktop is locked. While `true`, the compositor drops all input
// to clients, so reloading or editing the page cannot unlock it. The page
// still gets keys, so it can draw a lock screen and send the passphrase with
// `unlock`.
//
// Sent on change and on connect. Not sent when `lock.passphrase` is unset. See
// `docs/LOCK.md`.
const lockedSchema = z.looseObject({
  // Required: defaulting to `false` would hide the lock screen while input
  // stays blocked.
  locked: z.boolean(),
  type: z.literal("locked"),
});

// The theme client windows use. Sent with the handshake and after a theme
// change, once every chrome has captured its transition frame and the windows
// have repainted. Required, like `theme`.
const windowsThemeMessageSchema = z.looseObject({
  theme: themeSchema,
  type: z.literal("windows_theme"),
});

// Maps each typeable keysym to its evdev key, for resolving shell shortcuts.
// Sent after the handshake and when the layout changes.
export const shellConfigSchema = z.looseObject({
  keys: z.record(z.string(), z.number().int().nonnegative()),
  type: z.literal("shell_config"),
});

// The full audio state: devices, streams and cards. Pushed on change and on
// connect. Not sent without a sound server.
const audioChoiceSchema = z.looseObject({
  available: z.boolean(),
  description: z.string(),
  name: z.string(),
});

const audioDeviceSchema = z.looseObject({
  default: z.boolean(),
  description: z.string(),
  id: z.string(),
  monitor: z.boolean(),
  muted: z.boolean(),
  port: z.string().nullable(),
  ports: z.array(audioChoiceSchema),
  volume: z.number(),
});

const audioStreamSchema = z.looseObject({
  application: z.string(),
  device: z.string().nullable(),
  id: z.string(),
  muted: z.boolean(),
  title: z.string().nullable(),
  volume: z.number(),
});

const audioSchema = z.looseObject({
  cards: z.array(
    z.looseObject({
      description: z.string(),
      id: z.string(),
      profile: z.string().nullable(),
      profiles: z.array(audioChoiceSchema),
    }),
  ),
  inputs: z.array(audioDeviceSchema),
  outputs: z.array(audioDeviceSchema),
  playback: z.array(audioStreamSchema),
  recording: z.array(audioStreamSchema),
  type: z.literal("audio"),
});

// Meter peaks, about 20 times a second while any meter is watched.
const audioLevelsSchema = z.looseObject({
  levels: z.array(z.looseObject({ id: z.string(), peak: z.number() })),
  type: z.literal("audio_levels"),
});

const systemErrorSchema = z.looseObject({
  kind: z.enum([
    "not_found",
    "permission_denied",
    "already_exists",
    "not_a_directory",
    "is_a_directory",
    "invalid_input",
    "locked",
    "dbus",
    "other",
  ]),
  message: z.string(),
});

const fileTypeSchema = z.enum(["file", "directory", "symlink", "other"]);

// The answer to a `system_request`. Bytes are base64. See
// `docs/architecture/SYSTEM-ACCESS.md`.
const systemReplySchema = z.looseObject({
  id: z.number(),
  reply: z.discriminatedUnion("kind", [
    z.looseObject({ data: z.string(), kind: z.literal("read") }),
    z.looseObject({ kind: z.literal("written") }),
    z.looseObject({
      entries: z.array(
        z.looseObject({ file_type: fileTypeSchema, name: z.string() }),
      ),
      kind: z.literal("entries"),
    }),
    z.looseObject({
      file_type: fileTypeSchema,
      kind: z.literal("stat"),
      modified_ms: z.number().nullable(),
      size: z.number(),
    }),
    z.looseObject({
      body: z.string(),
      kind: z.literal("returned"),
      signature: z.string(),
    }),
    z.looseObject({ kind: z.literal("started") }),
    z.looseObject({ error: systemErrorSchema, kind: z.literal("failed") }),
  ]),
  type: z.literal("system_reply"),
});

// Output from a running process, or a change a watch saw.
const systemEventSchema = z.looseObject({
  event: z.discriminatedUnion("kind", [
    z.looseObject({
      data: z.string(),
      kind: z.literal("output"),
      stream: z.enum(["stdout", "stderr"]),
    }),
    z.looseObject({ kind: z.literal("changed"), path: z.string() }),
    z.looseObject({
      body: z.string(),
      interface: z.string(),
      kind: z.literal("signal"),
      member: z.string(),
      path: z.string(),
      sender: z.string(),
      signature: z.string(),
    }),
  ]),
  id: z.number(),
  type: z.literal("system_event"),
});

// The last message for a watch or process.
const systemEndSchema = z.looseObject({
  end: z.discriminatedUnion("kind", [
    z.looseObject({
      code: z.number().nullable(),
      kind: z.literal("exited"),
      signal: z.number().nullable(),
    }),
    z.looseObject({ kind: z.literal("stopped") }),
    z.looseObject({ error: systemErrorSchema, kind: z.literal("failed") }),
  ]),
  id: z.number(),
  type: z.literal("system_end"),
});

/**
 * A host message this build understands. {@link parseHostMessage} returns
 * `undefined` for unknown types so a newer host can add messages.
 */
export const hostMessageSchema = z.discriminatedUnion("type", [
  welcomeSchema,
  appAppearedSchema,
  appTitledSchema,
  appResizedSchema,
  popupPlacedSchema,
  appMinSizeSchema,
  appMaxSizeSchema,
  appClosedSchema,
  appCursorSchema,
  displaysSchema,
  keymapSchema,
  extensionsSchema,
  focusChangedSchema,
  focusRequestedSchema,
  shortcutMessageSchema,
  modifiersSchema,
  foundFilesSchema,
  filePreviewSchema,
  brightnessSchema,
  audioSchema,
  audioLevelsSchema,
  clipboardSchema,
  traySchema,
  notificationsSchema,
  themeMessageSchema,
  idleSchema,
  lockedSchema,
  windowsThemeMessageSchema,
  shellConfigSchema,
  systemReplySchema,
  systemEventSchema,
  systemEndSchema,
]);

/** A decoded host message. */
export type HostMessage = z.infer<typeof hostMessageSchema>;

/** A host message as decoded from JSON. Same type as {@link HostMessage}. */
export type HostMessageJson = z.infer<typeof hostMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type AppAppearedMessage = z.infer<typeof appAppearedSchema>;
export type AppTitledMessage = z.infer<typeof appTitledSchema>;
export type AppResizedMessage = z.infer<typeof appResizedSchema>;
export type PopupPlacedMessage = z.infer<typeof popupPlacedSchema>;
export type AppMinSizeMessage = z.infer<typeof appMinSizeSchema>;
export type AppMaxSizeMessage = z.infer<typeof appMaxSizeSchema>;
export type AppClosedMessage = z.infer<typeof appClosedSchema>;
export type AppCursorMessage = z.infer<typeof appCursorSchema>;
export type DisplaysMessage = z.infer<typeof displaysSchema>;
export type KeymapMessage = z.infer<typeof keymapSchema>;
export type FocusChangedMessage = z.infer<typeof focusChangedSchema>;
export type FocusRequestedMessage = z.infer<typeof focusRequestedSchema>;
export type ShortcutMessage = z.infer<typeof shortcutMessageSchema>;
export type ModifiersMessage = z.infer<typeof modifiersSchema>;
export type FoundFilesMessage = z.infer<typeof foundFilesSchema>;
export type FilePreviewMessage = z.infer<typeof filePreviewSchema>;
export type ClipboardMessage = z.infer<typeof clipboardSchema>;
export type TrayMessage = z.infer<typeof traySchema>;
export type NotificationsMessage = z.infer<typeof notificationsSchema>;
export type ThemeMessage = z.infer<typeof themeMessageSchema>;
export type IdleMessage = z.infer<typeof idleSchema>;
export type LockedMessage = z.infer<typeof lockedSchema>;
export type WindowsThemeMessage = z.infer<typeof windowsThemeMessageSchema>;
export type ShellConfigMessage = z.infer<typeof shellConfigSchema>;
export type SystemReplyMessage = z.infer<typeof systemReplySchema>;
export type SystemEventMessage = z.infer<typeof systemEventSchema>;
export type SystemEndMessage = z.infer<typeof systemEndSchema>;

/** One thing that was copied, as a row of the clipboard's history. */
export type ClipboardEntry = z.infer<typeof clipboardEntrySchema>;

/** One display of the desktop, in the coordinates the shell lays out in. */
export type DisplayInfo = z.infer<typeof displayInfoSchema>;

/** The `type` tag of every host message this build knows how to decode. */
export type HostMessageType = HostMessage["type"];

/** Narrow a decoded host message to one variant, for a handler signature. */
export type HostMessageOf<T extends HostMessageType> = Extract<
  HostMessage,
  { type: T }
>;

// A frame without a string `type` is malformed, not unknown.
const envelopeSchema = z.looseObject({ type: z.string() });

const KNOWN_TYPES: ReadonlySet<string> = new Set(
  hostMessageSchema.options.map((option) => option.shape.type.value),
);

/**
 * Decode one frame of host JSON.
 *
 * @returns The typed message, or `undefined` for an unknown `type`. Throws on
 *   invalid JSON, a missing `type`, or a known `type` with a bad payload.
 */
export const parseHostMessage = (text: string): HostMessageJson | undefined => {
  const envelope = envelopeSchema.parse(JSON.parse(text));
  return KNOWN_TYPES.has(envelope.type)
    ? hostMessageSchema.parse(envelope)
    : undefined;
};
