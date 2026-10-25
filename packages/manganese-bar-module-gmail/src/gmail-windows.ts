import type { Browser } from "@domicile-desktop/sdk/desktop/browser";

import { GMAIL_ORIGIN } from "./addresses";

type Desk = { readonly browser: Pick<Browser, "on" | "windows"> };

/**
 * Calls `onChange` when a Gmail browser window opens, closes, navigates or
 * changes title: the user is reading mail, so the inbox has likely changed.
 * Returns a function that stops the watch.
 */
export const watchGmailWindows = (
  domicile: Desk,
  onChange: () => void,
): (() => void) => {
  const seen = { windows: gmailWindows(domicile) };
  const windowsChanged = () => {
    const windows = gmailWindows(domicile);
    if (windows !== seen.windows) {
      seen.windows = windows;
      onChange();
    }
  };
  return domicile.browser.on("change", windowsChanged);
};

/** Every Gmail window's id, address and title, as one string to compare. */
const gmailWindows = (domicile: Desk): string =>
  JSON.stringify(
    (domicile.browser.windows ?? [])
      .filter((window) => URL.parse(window.url)?.origin === GMAIL_ORIGIN)
      .map((window) => [window.id, window.url, window.title]),
  );
