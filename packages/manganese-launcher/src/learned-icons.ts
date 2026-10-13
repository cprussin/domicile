import { z } from "zod";

// Bookmark icons learned from the launcher's page previews.
//
// The preview loads with the user's sign-in, so it can find icons that the
// anonymous lookup (`@domicile-desktop/system-apps/favicon`) can't. Stored per
// bookmark in `localStorage`, which every page of the desk shares, so they
// persist across reloads.

/** Storage key, versioned per the rule for persisted state. */
const ICONS_KEY = "bookmark-icons:v1";

const iconsSchema = z.record(z.string(), z.string());

/** Learned icons, by bookmark URL. */
export type LearnedIcons = Readonly<Record<string, string>>;

/**
 * The icons learned so far.
 *
 * Parsed rather than cast, because the stored value may be invalid. An
 * unreadable value counts as no icons.
 */
export const learnedIcons = (): LearnedIcons => {
  const stored = globalThis.localStorage.getItem(ICONS_KEY);
  return stored === null
    ? {}
    : (storedIconsSchema.safeParse(stored).data ?? {});
};

/** Record `icon` as `bookmark`'s learned icon. */
export const learnIcon = (bookmark: string, icon: string): void => {
  globalThis.localStorage.setItem(
    ICONS_KEY,
    JSON.stringify({ ...learnedIcons(), [bookmark]: icon }),
  );
};

// Report invalid JSON as a parse issue rather than throwing, so it is treated
// like any other invalid value.
const storedIconsSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(iconsSchema);
