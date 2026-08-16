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
export const PROTOCOL_VERSION = 1;

const sizeSchema = z.tuple([z.number(), z.number()]);

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

const appFrameSchema = z.looseObject({
  app_id: z.string(),
  data: z.string(),
  format: z.string(),
  height: z.number(),
  type: z.literal("app_frame"),
  width: z.number(),
});

const appClosedSchema = z.looseObject({
  app_id: z.string(),
  type: z.literal("app_closed"),
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
]);

export type HostMessage = z.infer<typeof hostMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type AppAppearedMessage = z.infer<typeof appAppearedSchema>;
export type AppResizedMessage = z.infer<typeof appResizedSchema>;
export type AppFrameMessage = z.infer<typeof appFrameSchema>;
export type AppClosedMessage = z.infer<typeof appClosedSchema>;

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
export const parseHostMessage = (text: string): HostMessage | undefined => {
  const envelope = envelopeSchema.parse(JSON.parse(text));
  return KNOWN_TYPES.has(envelope.type)
    ? hostMessageSchema.parse(envelope)
    : undefined;
};
