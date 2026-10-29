import { WEBVIEW_WAKE_LOCK_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useReducer } from "react";

/**
 * What the compositor calls a hold from the engine's browser process: a
 * browser window's page, which `<webview>`'s `wakeLock` names. See
 * docs/IDLE.md.
 */
export const BROWSER = "domicile-browser";

/** A browser window's page keeping the screens on. */
export type WakeLockedPage = {
  /** The page's icon URL, or `undefined` for none. */
  readonly icon: string | undefined;
  /** The page's site as a person reads it: its host without `www.`. */
  readonly site: string;
};

/**
 * The pages of the browser windows in `page` keeping the screens on. Read on
 * each render, so a window closed since is gone, and again on each change.
 */
export const useWakeLockedPages = (
  page: ParentNode & EventTarget = document,
): readonly WakeLockedPage[] => {
  const [, reread] = useReducer((reads: number) => reads + 1, 0);

  useEffect(() => {
    page.addEventListener(WEBVIEW_WAKE_LOCK_CHANGE_EVENT, reread);
    return () => {
      page.removeEventListener(WEBVIEW_WAKE_LOCK_CHANGE_EVENT, reread);
    };
  }, [page]);

  return [...page.querySelectorAll("webview")]
    .filter((view) => view.wakeLock)
    .map((view) => ({
      icon: view.favicon === "" ? undefined : view.favicon,
      site: new URL(view.url).hostname.replace(/^www\./u, ""),
    }));
};

/**
 * What keeps the screens on, once each: the apps among `holders`, and, while
 * {@link BROWSER} holds, the sites of `pages`. A browser window's hold with no
 * page reporting it, such as the shell's own page, is a web page.
 */
export const keepingAwake = (
  holders: readonly string[],
  pages: readonly WakeLockedPage[],
): { apps: readonly string[]; sites: readonly WakeLockedPage[] } => ({
  apps: [...new Set(holders)].filter((holder) => holder !== BROWSER),
  sites: holders.includes(BROWSER) ? sitesOf(pages) : [],
});

/** `pages`, once per site, or a web page for none. */
const sitesOf = (
  pages: readonly WakeLockedPage[],
): readonly WakeLockedPage[] =>
  pages.length === 0
    ? [{ icon: undefined, site: "a web page" }]
    : [...new Map(pages.map((page) => [page.site, page])).values()];
