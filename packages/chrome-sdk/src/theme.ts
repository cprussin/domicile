// The desktop theme a shell reads and sets.
//
// There is no `system` option: the shell is the desktop, so there is no
// higher preference to follow. Read the theme from `theme` messages, not
// `prefers-color-scheme`. `theme.mode` sets the initial theme and `setTheme`
// changes it.
//
// Unknown values are rejected, not defaulted, so a typo cannot flip the
// theme.
//
// The same list exists in `domicile-config`, `domicile-protocol`, the
// engine's `theme.h`, `mojom::Theme` and `domicile_theme.idl`.
// `scripts/test-themes-agree.sh` checks they match in members and order.

import { z } from "zod";

export const themeSchema = z.enum(["dark", "light"]);

/** The desktop theme. */
export type Theme = z.infer<typeof themeSchema>;
