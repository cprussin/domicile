import { z } from "zod";

// How far the user moved automatic brightness from its curve, stored locally
// so the desk keeps it across restarts. Every page of the desktop shares one
// origin, so they read the same offset.

/** The storage key, versioned per the persisted-state rule. */
export const OFFSET_KEY = "auto-brightness:v1";

const offsetSchema = z.object({ offset: z.number().min(-1).max(1) });

/**
 * The stored offset, or none (0) if nothing is stored.
 *
 * Parsed rather than cast: an unreadable value counts as nothing learned.
 */
export const learnedOffset = (
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): number => {
  const stored = storage.getItem(OFFSET_KEY);
  return stored === null ? 0 : parseOffset(stored);
};

/** Store `offset` for other pages and future loads. */
export const learnOffset = (
  offset: number,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void => {
  storage.setItem(OFFSET_KEY, JSON.stringify({ offset }));
};

/** `stored` as an offset, or 0 if it is not one. */
export const parseOffset = (stored: string): number =>
  storedOffsetSchema.safeParse(stored).data?.offset ?? 0;

// Invalid JSON is a parse issue, not a throw, so it is handled like any other
// invalid value.
const storedOffsetSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(offsetSchema);
