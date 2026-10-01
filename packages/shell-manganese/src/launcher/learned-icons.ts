import { z } from "zod";

// The icons bookmarks' own pages name for themselves, learned from the preview
// the launcher shows of each. That page is the user's browser, signed in as
// they are, so it names the icon a site keeps for people signed in — which the
// compositor's anonymous lookup never sees. Written down per bookmark, so a
// bookmark previewed once keeps its icon across reloads and on every page of
// the desk — they are one origin.

/** Where they are kept, suffixed per the versioning rule for persisted state. */
const ICONS_KEY = "bookmark-icons:v1";

const iconsSchema = z.record(z.string(), z.string());

/** Each bookmark's learned icon, by the bookmark's URL. */
export type LearnedIcons = Readonly<Record<string, string>>;

/**
 * The icons learned so far, or none on a machine that has seen no page.
 *
 * Parsed rather than cast, because anything can be under the key: a value
 * this build cannot read is no icons, and every bookmark is drawn with the
 * compositor's until its page is seen again.
 */
export const learnedIcons = (): LearnedIcons => {
  const stored = globalThis.localStorage.getItem(ICONS_KEY);
  return stored === null
    ? {}
    : (storedIconsSchema.safeParse(stored).data ?? {});
};

/** Write down that `bookmark`'s page names `icon`. */
export const learnIcon = (bookmark: string, icon: string): void => {
  globalThis.localStorage.setItem(
    ICONS_KEY,
    JSON.stringify({ ...learnedIcons(), [bookmark]: icon }),
  );
};

// JSON that is not JSON is an issue of the parse rather than a throw, so a
// mangled value is no icons like any other value that is not icons.
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
