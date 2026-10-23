import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { GMAIL_ORIGIN } from "./addresses";

type Desk = Pick<
  DomicileHost,
  "addEventListener" | "browserWindows" | "removeEventListener"
>;

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
  domicile.addEventListener("browserwindowschanged", windowsChanged);
  return () => {
    domicile.removeEventListener("browserwindowschanged", windowsChanged);
  };
};

/** Every Gmail window's id, address and title, as one string to compare. */
const gmailWindows = (domicile: Desk): string =>
  JSON.stringify(
    (domicile.browserWindows ?? [])
      .filter((window) => URL.parse(window.url)?.origin === GMAIL_ORIGIN)
      .map((window) => [window.id, window.url, window.title]),
  );
