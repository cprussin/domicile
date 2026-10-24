import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";

/**
 * Messages' unread conversations in its list. Muted ones are left out, as
 * Messages leaves them out of its notifications. The attributes are the ones
 * Google's own end-to-end tests read.
 */
export const UNREAD_CONVERSATIONS =
  '[data-e2e-is-unread="true"]:not([data-e2e-is-muted="true"])';

/** How often the count is read again. A read is one selector match. */
const EVERY_MS = 5000;

/** Calls `run` every few seconds, until the returned function is called. */
const everyFewSeconds = (run: () => void) => {
  const timer = setInterval(run, EVERY_MS);
  return () => {
    clearInterval(timer);
  };
};

/** Logs a count the page did not give; the next tick reads again. */
const logMissed = (error: unknown) => {
  // biome-ignore lint/suspicious/noConsole: surfacing a missed read
  console.warn("Google Messages gave no unread count", error);
};

/**
 * Reads Messages' unread conversations from its page, when the page finishes
 * loading and then on every tick, and calls `onCount` with each count.
 * Returns what stops it.
 */
export const watchUnread = (
  view: HTMLWebViewElement,
  onCount: (count: number) => void,
  every: typeof everyFewSeconds = everyFewSeconds,
  onMissed: typeof logMissed = logMissed,
): (() => void) => {
  const read = () => {
    view.countMatches(UNREAD_CONVERSATIONS).then(onCount, onMissed);
  };
  const loaded = () => {
    if (!view.loading) {
      read();
    }
  };
  view.addEventListener(WEBVIEW_LOADING_CHANGE_EVENT, loaded);
  const stop = every(read);
  return () => {
    view.removeEventListener(WEBVIEW_LOADING_CHANGE_EVENT, loaded);
    stop();
  };
};
