import type {
  WebViewAdBlocking,
  WebViewAdBlockingSetFor,
  WebViewPrivacyProtection,
} from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_AD_BLOCKING_MODES,
  WEBVIEW_AD_BLOCKING_SET_FOR,
  WEBVIEW_PRIVACY_PROTECTIONS,
  WEBVIEW_SITE_PRIVACY_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** One of a page's other protections, as its view reports it. */
export type PageProtection = {
  on: boolean;
  /** Where {@link PageProtection.on} comes from, the mode aside. */
  setFor: WebViewAdBlockingSetFor;
};

/** What the shield shows for a page, as its view reports it. */
export type SitePrivacy = {
  /** Ads and trackers blocked since the page loaded. */
  blocked: number;
  /** How the page blocks ads and trackers. */
  mode: WebViewAdBlocking;
  /**
   * Each protection beside it the page reports, in
   * {@link WEBVIEW_PRIVACY_PROTECTIONS}' order. Each is off while
   * {@link SitePrivacy.mode} is `off`.
   */
  protections: Partial<Record<WebViewPrivacyProtection, PageProtection>>;
  /** Where {@link SitePrivacy.mode} comes from. */
  setFor: WebViewAdBlockingSetFor;
  /** The site the mode is kept for, such as `nytimes.com`. */
  site: string;
};

/**
 * Each protection `view` reports, leaving out one it reports in a way the
 * shell doesn't know, which says so on the console. None from an engine
 * before them.
 */
const protectionsOf = (
  view: HTMLWebViewElement,
): SitePrivacy["protections"] => {
  if ("privacyProtections" in view) {
    const on = view.privacyProtections();
    const setFor = view.privacyProtectionsSetFor();
    const protections: SitePrivacy["protections"] = {};
    for (const protection of WEBVIEW_PRIVACY_PROTECTIONS) {
      const reported = on[protection];
      const from = WEBVIEW_AD_BLOCKING_SET_FOR.find(
        (known) => known === setFor[protection],
      );
      if (reported === undefined && setFor[protection] === undefined) {
        // An engine before this protection.
        continue;
      } else if (
        (reported !== "on" && reported !== "off") ||
        from === undefined
      ) {
        // biome-ignore lint/suspicious/noConsole: the shield leaves its switch out, and this says why
        console.error(
          "The page reported a protection the shell doesn't know",
          protection,
          reported,
          setFor[protection],
        );
      } else {
        protections[protection] = { on: reported === "on", setFor: from };
      }
    }
    return protections;
  } else {
    return {};
  }
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
        protections: protectionsOf(view),
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
