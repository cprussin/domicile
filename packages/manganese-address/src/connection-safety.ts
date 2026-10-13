// The connection security a browser window reports for its page.
//
// The engine computes the verdict with `security_state::GetSecurityLevel`, as
// Chrome's omnibox does, and sets it on the `<webview>` (see
// `WEBVIEW_PAGE_CHANGE_EVENT` in `@domicile-desktop/sdk/webview-element`).
// This module only parses it. Never derive security from the URL scheme:
// `https://` does not mean the certificate validated.

import { WEBVIEW_SECURITY_LEVELS } from "@domicile-desktop/sdk/webview-element";
import { z } from "zod";

/** What the browser says about the connection under the page being shown. */
export enum ConnectionSafety {
  /**
   * The browser has not reported a verdict, and the shell will not guess.
   *
   * Covers a guest on its initial entry, an older engine without the
   * property, and an unknown newer level. Guessing could show a `dangerous`
   * page as safe.
   */
  Unstated,
  /** Neither secure nor insecure: `about:blank`, a file, an error page. */
  Neutral,
  /** HTTPS whose certificate validated, with nothing on the page undoing it. */
  Secure,
  /** What a browser marks "Not secure": plain HTTP, or an HTTPS it distrusts. */
  Warning,
  /** A failed certificate, active mixed content, a connection that failed. */
  Dangerous,
}

/**
 * Parses the element's `security` property, or returns {@link
 * ConnectionSafety.Unstated} for anything that is not a known verdict.
 *
 * Accepts `undefined` because older engines do not set the property.
 */
export const connectionSafety = (
  reported: string | undefined,
): ConnectionSafety => {
  const level = levelSchema.safeParse(reported);
  // `safeParse`, not a throw: the engine may be older or newer than this
  // page, and an unknown level must not break the browser window.
  if (level.success) {
    return VERDICTS[level.data];
  } else {
    return ConnectionSafety.Unstated;
  }
};

/** The levels the engine reports, as the SDK spells them. */
const levelSchema = z.enum(WEBVIEW_SECURITY_LEVELS);

/**
 * Maps the engine's level strings to {@link ConnectionSafety}. The
 * deserializer for this boundary; see
 * [DATA.md](/docs/guidelines/DATA.md).
 */
const VERDICTS: Readonly<
  Record<z.infer<typeof levelSchema>, ConnectionSafety>
> = {
  dangerous: ConnectionSafety.Dangerous,
  neutral: ConnectionSafety.Neutral,
  secure: ConnectionSafety.Secure,
  warning: ConnectionSafety.Warning,
};
