import type { Browser } from "@domicile-desktop/sdk/desktop/browser";
import { AppReuse } from "@domicile-desktop/sdk/desktop/browser";

import { GMAIL_ORIGIN, gmailAppId, inboxAddress } from "./addresses";

/** The path of an account's mail page. */
const MAIL_PATH = /^\/mail\/u\/\d+\/$/;

/** The browser {@link openMail} opens Gmail in. */
export type MailBrowser = Pick<Browser, "on" | "openApp" | "windows">;

/**
 * Shows `place`, a Gmail hash such as `#inbox/<thread>`, in the account's
 * Gmail window. It changes only the hash of a running Gmail mail page, as a
 * click in Gmail does, so Gmail keeps its inbox list beside the message.
 * Loading the message's address afresh shows the message alone. With no such
 * page open, it loads the inbox first. Returns a function that stops waiting
 * for Gmail to start. A new window is in browser profile `profile`, or its
 * site's when `undefined`.
 */
export const openMail = (
  browser: MailBrowser,
  email: string,
  place: string,
  profile?: string,
): (() => void) => {
  const id = gmailAppId(email);
  const inProfile = profile === undefined ? {} : { profile };
  const show = (started: URL) => {
    started.hash = place;
    browser.openApp(started.href, {
      id,
      reuse: AppReuse.Navigate,
      ...inProfile,
    });
  };
  const open = listed(browser, id);
  const started = open === undefined ? undefined : startedAt(open.url);
  if (started === undefined) {
    browser.openApp(inboxAddress(email), {
      id,
      reuse: AppReuse.Navigate,
      ...inProfile,
    });
    return whenStarted(browser, id, show);
  } else {
    show(started);
    return () => undefined;
  }
};

/**
 * Calls `then` with the address of window `id`'s page once Gmail has started
 * in it. Gives up when the window closes after it was listed. Returns a
 * function that stops the wait.
 */
const whenStarted = (
  browser: MailBrowser,
  id: string,
  then: (started: URL) => void,
): (() => void) => {
  const watch = { seen: listed(browser, id) !== undefined };
  const stop = browser.on("change", () => {
    const window = listed(browser, id);
    if (window === undefined) {
      // Closed before Gmail started: nothing is left to show it in.
      if (watch.seen) {
        stop();
      }
    } else {
      watch.seen = true;
      const started = startedAt(window.url);
      if (started !== undefined) {
        stop();
        then(started);
      }
    }
  });
  return stop;
};

/**
 * The Gmail mail page's address once Gmail has started: it sets a hash, such
 * as `#inbox`, when its app is running. `undefined` before then, such as on
 * the sign-in page or the redirect to `/mail/u/<n>/`, and on Gmail's other
 * apps, such as Chat at `/chat/u/<n>/`.
 */
const startedAt = (url: string): URL | undefined => {
  const parsed = URL.parse(url);
  return parsed?.origin === GMAIL_ORIGIN &&
    MAIL_PATH.test(parsed.pathname) &&
    parsed.hash !== ""
    ? parsed
    : undefined;
};

/** Window `id`, once the browser lists it. */
const listed = (browser: MailBrowser, id: string) =>
  browser.windows?.find(({ appId }) => appId === id);
