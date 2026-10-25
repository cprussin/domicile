import { z } from "zod";

// The night light the user turned on or off from the bar, against its
// schedule, stored locally so a reload keeps it. Every page of the desktop
// shares one origin, so they read the same override.

/** The storage key, versioned per the persisted-state rule. */
export const OVERRIDE_KEY = "night-light:v1";

const overrideSchema = z.object({
  on: z.boolean(),
  until: z.number().optional(),
});

/** The night light held on or off, until `until` (ms since the epoch) or for good. */
export type Override = z.infer<typeof overrideSchema>;

/**
 * The stored override, or none.
 *
 * Parsed rather than cast: an unreadable value counts as none, and the night
 * light keeps its schedule.
 */
export const storedOverride = (): Override | undefined => {
  const stored = globalThis.localStorage.getItem(OVERRIDE_KEY);
  return stored === null ? undefined : parseOverride(stored);
};

/** Store `override` for other pages and future loads, or clear it. */
export const storeOverride = (override: Override | undefined): void => {
  if (override === undefined) {
    globalThis.localStorage.removeItem(OVERRIDE_KEY);
  } else {
    globalThis.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(override));
  }
};

/** `stored` as an override, or none if it is not one. */
export const parseOverride = (stored: string): Override | undefined =>
  storedOverrideSchema.safeParse(stored).data;

// Invalid JSON is a parse issue, not a throw, so it is handled like any other
// invalid value.
const storedOverrideSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(overrideSchema);
