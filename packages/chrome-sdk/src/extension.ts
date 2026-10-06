// One browser extension, as a shell's tray draws it.
//
// `extensionSchema` parses the rows of `window.domicile.extensions`. The
// engine and the SDK ship separately, so the data is validated rather than
// trusted.

import { z } from "zod";

/** A Chromium extension id: 32 letters `a` through `p`. */
const EXTENSION_ID = /^[a-p]{32}$/;

/** The engine renders every icon as a PNG data URL. */
const PNG_DATA_URL = "data:image/png;base64,";

export const extensionSchema = z.object({
  /** A CSS color, `#rrggbbaa`; transparent when the extension set none. */
  badgeColor: z.string(),
  badgeText: z.string(),
  /** `false` after the extension's `action.disable()`. */
  enabled: z.boolean(),
  /** A PNG at the page's device pixel ratio, as a data URL. */
  icon: z.string().startsWith(PNG_DATA_URL),
  /** The id to pass to `DomicileHost.activateExtension`. */
  id: z.string().regex(EXTENSION_ID),
  name: z.string(),
  /**
   * The popup to open in a `<webview>` on click, or `undefined` when the click
   * fires `action.onClicked`. Either way, call
   * `DomicileHost.activateExtension`. The engine sends `null`.
   */
  popup: z
    .string()
    .nullable()
    .transform((popup) => popup ?? undefined),
  /** The action's tooltip. */
  title: z.string(),
});

export type Extension = z.infer<typeof extensionSchema>;
