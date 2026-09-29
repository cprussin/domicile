// One extension in the tray, as a shell draws it.
//
// Its own module because both halves of the SDK read it: `host-message.ts`
// turns the engine's `extensions` event into a list of these, and a shell's
// tray renders them. Parsed rather than passed through, as `appCursor` is: the
// engine and this SDK ship apart, and a row this SDK cannot draw should be a
// stack rather than a blank button.

import { z } from "zod";

/** An extension id: 32 letters `a` through `p`, which is how Chromium makes them. */
const EXTENSION_ID = /^[a-p]{32}$/;

/** What the engine renders every icon to. */
const PNG_DATA_URL = "data:image/png;base64,";

export const extensionSchema = z.object({
  /** A CSS color, `#rrggbbaa`: fully transparent when the extension set none. */
  badgeColor: z.string(),
  badgeText: z.string(),
  /** `false` after the extension's `action.disable()`. */
  enabled: z.boolean(),
  /** A PNG at the page's device pixel ratio, as a data URL. */
  icon: z.string().startsWith(PNG_DATA_URL),
  /** What {@link DomicileClient.activateExtension} names it by. */
  id: z.string().regex(EXTENSION_ID),
  name: z.string(),
  /**
   * The popup to open in a `<webview>` on a click; `undefined` for an action
   * whose click is {@link DomicileClient.activateExtension}. The engine says
   * `null`, which is WebIDL's absence rather than this SDK's.
   */
  popup: z
    .string()
    .nullable()
    .transform((popup) => popup ?? undefined),
  /** The action's tooltip. */
  title: z.string(),
});

export type Extension = z.infer<typeof extensionSchema>;
