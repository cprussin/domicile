// What a browser window can say about the connection behind the page it is
// showing.
//
// IT IS THE BROWSER'S OWN ANSWER, NOT THE SHELL'S. The engine computes it with
// `security_state::GetSecurityLevel` over the guest's visible entry — the same
// function, over the same entry, that Chrome's omnibox lock comes from — and
// pushes it onto the `<webview>` with the address it belongs to. So this
// module does not decide anything about security. It parses what the element
// reports, at the boundary, and nothing past this file has to think about the
// wire at all.
//
// THIS USED TO BE A SCHEME TEST, and that was the bug. A lock drawn from
// `https://` claims a certificate validated, when nothing had looked: an
// expired cert, a name mismatch, a page running active mixed content and a
// connection that failed all read as `https://` and all got a padlock. The
// engine reports the real verdict now — see `WEBVIEW_PAGE_CHANGE_EVENT` in
// `@domicile/chrome-sdk/webview-element`.

import { WEBVIEW_SECURITY_LEVELS } from "@domicile/chrome-sdk/webview-element";
import { z } from "zod";

/** What the browser says about the connection under the page being shown. */
export enum ConnectionSafety {
  /**
   * The browser has not said, and the shell will not guess.
   *
   * Three things look like this and all three mean the same thing to a user:
   * a guest still showing its initial entry, an engine older than the contract
   * that reports this at all, and a verdict newer than this shell knows how to
   * read. None of them is a reason to draw a padlock, and the last is the
   * sharpest: guessing which known level an unknown one resembles is how a
   * `dangerous` page comes to be shown as a safe one.
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
 * What the element's `security` property means, or {@link
 * ConnectionSafety.Unstated} for anything this shell cannot read as a verdict.
 *
 * `undefined` as well as `string` because that is what an engine predating the
 * contract hands a chrome: the property is simply not there, and TypeScript's
 * word for the DOM is not a promise about the engine underneath it.
 */
export const connectionSafety = (
  reported: string | undefined,
): ConnectionSafety => {
  const level = levelSchema.safeParse(reported);
  // `safeParse` rather than a throw, which is the one place in this shell where
  // an unreadable value is not a bug to fail loudly on: the value comes from an
  // engine that may be older or newer than this page, and a browser window that
  // refused to render over an unfamiliar security level would be a desktop
  // taken down by an engine release.
  if (level.success) {
    return VERDICTS[level.data];
  } else {
    return ConnectionSafety.Unstated;
  }
};

/** The four the engine reports, as the SDK spells them. */
const levelSchema = z.enum(WEBVIEW_SECURITY_LEVELS);

/**
 * The wire's four words to this shell's four variants.
 *
 * The deserializer half of the boundary
 * [DATA.md](/docs/guidelines/DATA.md) asks for: the strings are the engine's
 * contract and the enum is what the rest of the shell switches on, and neither
 * has to know the other's vocabulary anywhere but here.
 */
const VERDICTS: Readonly<
  Record<z.infer<typeof levelSchema>, ConnectionSafety>
> = {
  dangerous: ConnectionSafety.Dangerous,
  neutral: ConnectionSafety.Neutral,
  secure: ConnectionSafety.Secure,
  warning: ConnectionSafety.Warning,
};
