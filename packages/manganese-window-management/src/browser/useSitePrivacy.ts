import type {
  WebViewAdBlocking,
  WebViewAdBlockingSetFor,
} from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_AD_BLOCKING_MODES,
  WEBVIEW_AD_BLOCKING_SET_FOR,
  WEBVIEW_SITE_PRIVACY_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** What the shield shows for a page, as its view reports it. */
export type SitePrivacy = {
  /** Ads and trackers blocked since the page loaded. */
  blocked: number;
  /** How the page blocks ads and trackers. */
  mode: WebViewAdBlocking;
  /** Where {@link SitePrivacy.mode} comes from. */
  setFor: WebViewAdBlockingSetFor;
  /** The site the mode is kept for, such as `nytimes.com`. */
  site: string;
};

/**
 * What `view` reports of its page's privacy, or nothing for a page that is
 * never blocked (not `http` or `https`) or an engine before ad blocking.
 *
 * The engine's report is external data, so an unknown mode or source is
 * nothing too, and says so on the console: the engine and SDK disagree.
 */
export const sitePrivacyOf = (
  view: HTMLWebViewElement,
): SitePrivacy | undefined => {
  if (!("privacySite" in view) || view.privacySite === "") {
    return undefined;
  } else {
    const mode = WEBVIEW_AD_BLOCKING_MODES.find(
      (known) => known === view.blockAdsAndTrackers,
    );
    const setFor = WEBVIEW_AD_BLOCKING_SET_FOR.find(
      (known) => known === view.blockAdsAndTrackersSetFor,
    );
    if (mode === undefined || setFor === undefined) {
      // biome-ignore lint/suspicious/noConsole: the shield hides, and this says why
      console.error(
        "The page reported ad blocking the shell doesn't know",
        view.blockAdsAndTrackers,
        view.blockAdsAndTrackersSetFor,
      );
      return undefined;
    } else {
      return {
        blocked: view.blockedCount,
        mode,
        setFor,
        site: view.privacySite,
      };
    }
  }
};

/**
 * The page's privacy in `view` (see {@link sitePrivacyOf}), read on mount
 * and on each change event, as `useSitePermissions` does.
 *
 * Takes `null` because the element comes from a callback ref.
 */
export const useSitePrivacy = (
  view: HTMLWebViewElement | null,
): SitePrivacy | undefined => {
  const [privacy, setPrivacy] = useState<SitePrivacy | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      setPrivacy(undefined);
      return undefined;
    } else {
      const read = () => {
        setPrivacy(sitePrivacyOf(view));
      };
      read();
      view.addEventListener(WEBVIEW_SITE_PRIVACY_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_SITE_PRIVACY_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return privacy;
};
