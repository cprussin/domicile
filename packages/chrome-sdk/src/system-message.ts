// The compositor's answers to a system call, as a `system` event's `data`
// carries them. See docs/SHELL-SYSTEM-ACCESS.md. The rest of the
// compositor's protocol lives in @domicile-desktop/e2e-harness; a page hears
// only these three.

import { z } from "zod";

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
    "canceled",
    "other",
  ]),
  message: z.string(),
});

const fileTypeSchema = z.enum(["file", "directory", "symlink", "other"]);

// The answer to a `system_request`. Bytes are base64.
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
    z.looseObject({ kind: z.literal("saved"), path: z.string() }),
    z.looseObject({ error: systemErrorSchema, kind: z.literal("failed") }),
  ]),
  type: z.literal("system_reply"),
});

// Output from a running process, a change a watch saw, or a signal a D-Bus
// match heard.
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

// The last message for a watch, process or D-Bus match.
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

const systemMessageSchema = z.discriminatedUnion("type", [
  systemReplySchema,
  systemEventSchema,
  systemEndSchema,
]);

export type SystemReplyMessage = z.infer<typeof systemReplySchema>;
export type SystemEventMessage = z.infer<typeof systemEventSchema>;
export type SystemEndMessage = z.infer<typeof systemEndSchema>;
export type SystemMessage = z.infer<typeof systemMessageSchema>;

/**
 * Decode one `system` event's line. Throws on anything else: the engine
 * relays only these three types, so another is a bug.
 */
export const parseSystemMessage = (text: string): SystemMessage =>
  systemMessageSchema.parse(JSON.parse(text));
