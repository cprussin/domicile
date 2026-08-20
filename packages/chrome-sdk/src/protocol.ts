// The wire contract with the Domicile host, mirroring the Rust
// `domicile-protocol` crate. Host messages arrive as untrusted JSON text, so
// they are parsed with zod rather than cast — the schemas below are the only
// place a raw frame becomes a typed value.
//
// Each schema is deliberately loose about unknown keys so a newer host can add
// fields without breaking an older chrome; it is strict about the fields the
// chrome actually reads.

import { z } from "zod";

/** The protocol version this build speaks. Must match the Rust constant. */
export const PROTOCOL_VERSION = 8;

const sizeSchema = z.tuple([z.number(), z.number()]);

// The shapes `wp_cursor_shape_v1` defines, named as the CSS `cursor` keyword
// the chrome assigns, plus `none` for a client that hides the cursor. Mirrors
// `domicile_protocol::CursorShape`; a value outside this set is a host bug, so
// the schema rejects it rather than letting an invalid keyword reach CSS.
const cursorShapeSchema = z.enum([
  "none",
  "default",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "e-resize",
  "n-resize",
  "ne-resize",
  "nw-resize",
  "s-resize",
  "se-resize",
  "sw-resize",
  "w-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "col-resize",
  "row-resize",
  "all-scroll",
  "zoom-in",
  "zoom-out",
]);

const welcomeSchema = z.looseObject({
  protocol_version: z.number(),
  type: z.literal("welcome"),
});

const appAppearedSchema = z.looseObject({
  app_id: z.string(),
  size: sizeSchema,
  // serde serialises `Option<String>::None` as JSON null; normalise it to
  // `undefined` at the boundary so no `null` leaks into the SDK.
  title: z
    .string()
    .nullish()
    .transform((title) => title ?? undefined),
  type: z.literal("app_appeared"),
});

const appResizedSchema = z.looseObject({
  app_id: z.string(),
  size: sizeSchema,
  type: z.literal("app_resized"),
});

// The pixels are not in this message; `bytes` counts the raw bytes that follow
// the header line on the socket. See `host-stream.ts`.
const appFrameSchema = z.looseObject({
  app_id: z.string(),
  bytes: z.number(),
  format: z.string(),
  // Device pixels, so the canvas backing store; divide by `scale` for the
  // logical size the element is laid out at.
  height: z.number(),
  scale: z.number(),
  type: z.literal("app_frame"),
  width: z.number(),
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

// A combination the chrome claimed, pressed. It arrives here rather than as a
// DOM event because the page is not what received it — the point of claiming
// one is that it works while a window has the keyboard.
const shortcutMessageSchema = z.looseObject({
  shortcut: shortcutSchema,
  type: z.literal("shortcut"),
});

// The counterpart to `app_frame`: the compositor is drawing this window's own
// buffer now, so whatever pixels the chrome holds for it are stale. It arrives
// after the last frame on the same socket, which is what makes it safe to act
// on — see `HostMessage::AppComposited`.
const appCompositedSchema = z.looseObject({
  app_id: z.string(),
  type: z.literal("app_composited"),
});

const appCursorSchema = z.looseObject({
  app_id: z.string(),
  cursor: cursorShapeSchema,
  type: z.literal("app_cursor"),
});

/**
 * A host message the chrome understands. Unknown `type` values are not an
 * error — {@link parseHostMessage} reports them separately so a newer host can
 * introduce messages an older chrome simply ignores.
 */
export const hostMessageSchema = z.discriminatedUnion("type", [
  welcomeSchema,
  appAppearedSchema,
  appResizedSchema,
  appFrameSchema,
  appClosedSchema,
  appCompositedSchema,
  appCursorSchema,
  shortcutMessageSchema,
]);

/**
 * A decoded host message. `app_frame` is the schema's shape plus the pixels the
 * transport read off the socket after the header — they never went through
 * JSON, so the schema cannot describe them.
 */
export type HostMessage =
  | Exclude<z.infer<typeof hostMessageSchema>, { type: "app_frame" }>
  | AppFrameMessage;

/** A host message exactly as it decodes from JSON, before pixels are joined. */
export type HostMessageJson = z.infer<typeof hostMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type AppAppearedMessage = z.infer<typeof appAppearedSchema>;
export type AppResizedMessage = z.infer<typeof appResizedSchema>;
/**
 * The header, plus the pixels that followed it on the socket. `bytes` is what
 * the header promised; `pixels` is what arrived, attached by the transport.
 */
export type AppFrameMessage = z.infer<typeof appFrameSchema> & {
  pixels: Uint8Array<ArrayBuffer>;
};
export type AppClosedMessage = z.infer<typeof appClosedSchema>;
export type AppCompositedMessage = z.infer<typeof appCompositedSchema>;
export type AppCursorMessage = z.infer<typeof appCursorSchema>;
export type ShortcutMessage = z.infer<typeof shortcutMessageSchema>;

/** A CSS `cursor` keyword a client can ask the chrome to show over its app. */
export type CursorShape = z.infer<typeof cursorShapeSchema>;

/** The `type` tag of every host message this build knows how to decode. */
export type HostMessageType = HostMessage["type"];

/** Narrow a decoded host message to one variant, for a handler signature. */
export type HostMessageOf<T extends HostMessageType> = Extract<
  HostMessage,
  { type: T }
>;

// Every frame carries a string `type`; only the payload beyond it varies. A
// frame that does not even have one is malformed rather than merely unknown.
const envelopeSchema = z.looseObject({ type: z.string() });

const KNOWN_TYPES: ReadonlySet<string> = new Set(
  hostMessageSchema.options.map((option) => option.shape.type.value),
);

/**
 * Decode one frame of host JSON.
 *
 * @returns The typed message, or `undefined` when the host sent a well-formed
 *   frame whose `type` this build does not know. Throws on JSON that does not
 *   parse, on a frame with no `type`, and on a known `type` whose payload does
 *   not match its schema — all of which are host bugs, not forward
 *   compatibility.
 */
export const parseHostMessage = (text: string): HostMessageJson | undefined => {
  const envelope = envelopeSchema.parse(JSON.parse(text));
  return KNOWN_TYPES.has(envelope.type)
    ? hostMessageSchema.parse(envelope)
    : undefined;
};
