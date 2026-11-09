import { z } from "zod";

// The notifications pause, stored locally so a reload keeps it. Every page of
// the desktop shares one origin, so they read the same pause.

/** The storage key, versioned per the persisted-state rule. */
const KEY = "notifications-paused:v1";

/** The key do not disturb was stored under; on means paused until resumed. */
const DO_NOT_DISTURB_KEY = "do-not-disturb:v1";

const pauseSchema = z.object({ until: z.number().optional() });

/** Notifications paused until `until` (ms since the epoch) or until resumed. */
export type Pause = z.infer<typeof pauseSchema>;

/**
 * The stored pause, or none. Do not disturb left on reads as a pause until
 * resumed.
 *
 * Parsed rather than cast: an unreadable value counts as none, and
 * notifications toast.
 */
export const storedPause = (): Pause | undefined => {
  const stored = globalThis.localStorage.getItem(KEY);
  if (stored === null) {
    return globalThis.localStorage.getItem(DO_NOT_DISTURB_KEY) === "on"
      ? {}
      : undefined;
  } else {
    return storedPauseSchema.safeParse(stored).data;
  }
};

/** Store `pause` for other pages and future loads, or clear it. */
export const storePause = (pause: Pause | undefined): void => {
  globalThis.localStorage.removeItem(DO_NOT_DISTURB_KEY);
  if (pause === undefined) {
    globalThis.localStorage.removeItem(KEY);
  } else {
    globalThis.localStorage.setItem(KEY, JSON.stringify(pause));
  }
};

// Invalid JSON is a parse issue, not a throw, so it is handled like any other
// invalid value.
const storedPauseSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(pauseSchema);
