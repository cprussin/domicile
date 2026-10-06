// The `applications` option: what the launcher offers beside files.

import { bookmarksSchema } from "@domicile-desktop/system-apps/bookmark";
import { z } from "zod";

/** Parses `runManganese`'s `applications`, filling in what it leaves out. */
export const applicationsConfigSchema = z
  .strictObject({
    /** Pages offered by name; see `docs/LAUNCHER.md`. */
    bookmarks: bookmarksSchema.default([]),
    /** Desktop file IDs to leave out, as globs; see `docs/LAUNCHER.md`. */
    omit: z.array(z.string()).readonly().default([]),
  })
  .default({ bookmarks: [], omit: [] });

export type ApplicationsConfig = z.output<typeof applicationsConfigSchema>;

/** The option as written, before defaults. */
export type ApplicationsOptions = z.input<typeof applicationsConfigSchema>;
