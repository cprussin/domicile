import { z } from "zod";

/**
 * `pactl subscribe` facilities that change mixer state. Client events are
 * left out: `pactl list` is itself a client, so rereading on them would loop.
 */
const NEWS = new Set([
  "sink",
  "source",
  "sink-input",
  "source-output",
  "card",
  "server",
]);

/**
 * Whether a `pactl -f json subscribe` line means mixer state changed. Throws
 * on a line that is not an event.
 */
export const announcesAChange = (line: string): boolean =>
  NEWS.has(eventSchema.parse(JSON.parse(line)).on);

const eventSchema = z.object({ on: z.string() });
