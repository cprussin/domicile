// Which way round the desktop is drawn.
//
// Two members, and the sixth writing of one closed set: `ThemeMode` in
// `domicile-config` parses the file a desk states it in, `Theme` in
// `domicile-protocol` is what the compositor serializes,
// `components/domicile/common/theme.h` is what the browser process parses that
// against, `mojom::Theme` is what crosses into the renderer, and
// `domicile_theme.idl` is the `DomicileTheme` the page's own type system
// holds. This is what a shell reads and writes.
//
// **THERE IS NO `system`, AND ITS ABSENCE IS THE DESIGN RATHER THAN A GAP.**
// Every other desktop's theme control has three positions because it is a
// program running *on* a desktop, with a system preference above it to defer
// to. A Domicile shell is the desktop: there is nothing above it, so a
// `system` here would be the desk deferring to itself.
//
// `prefers-color-scheme` still answers under this engine, as it answers in any
// browser, and it is the trap that looks like the answer — a shell that read
// it would be asking the engine what the engine was told, with a second place
// for the two to disagree. The theme is the compositor's: `[theme] mode` is
// what a desk comes up on, `setTheme` is what a toggle does to it, and a
// `theme` message is how both arrive.
//
// **Its own module rather than a member of `protocol.ts`, because both halves
// of the SDK need it and only one of them is the wire**: `protocol.ts` parses
// the compositor's JSON for the headless harness, and a shell reads this same
// name off `DomicileThemeEvent.theme`. One list, two readers — which is the
// arrangement `display-transform.ts` is in, for the same reason.
//
// Unlike that one, nothing here falls back. A turn nobody knows arrives as one
// field of a whole desktop, so refusing it would cost a shell every screen; a
// theme *is* the message, so there is nothing else in it to save — and the
// page is already painting in one of the two, which is a better answer than
// the other one picked by a typo. Both codecs in the engine refuse for the
// same reason.
//
// `scripts/test-themes-agree.sh` compares all six lists, for membership AND
// order, without building anything.

import { z } from "zod";

export const themeSchema = z.enum(["dark", "light"]);

/** Which way round the desktop is drawn. */
export type Theme = z.infer<typeof themeSchema>;
