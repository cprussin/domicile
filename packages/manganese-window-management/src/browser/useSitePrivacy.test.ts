import { describe, expect, it, spyOn } from "bun:test";
import { WEBVIEW_SITE_PRIVACY_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useSitePrivacy } from "./useSitePrivacy";

type Reported = {
  blockAdsAndTrackers: string;
  blockAdsAndTrackersSetFor: string;
  blockedCount: number;
  privacySite: string;
};

const NYTIMES: Reported = {
  blockAdsAndTrackers: "standard",
  blockAdsAndTrackersSetFor: "profile",
  blockedCount: 23,
  privacySite: "nytimes.com",
};

/** A view reporting `reported`, as the engine's element would. */
const viewReporting = (
  reported: Reported,
): HTMLWebViewElement & { report: (next: Reported) => void } => {
  let current = reported;
  const view = document.createElement("webview");
  Object.defineProperties(view, {
    blockAdsAndTrackers: { get: () => current.blockAdsAndTrackers },
    blockAdsAndTrackersSetFor: {
      get: () => current.blockAdsAndTrackersSetFor,
    },
    blockedCount: { get: () => current.blockedCount },
    privacySite: { get: () => current.privacySite },
  });
  return Object.assign(view, {
    report: (next: Reported) => {
      current = next;
      act(() => {
        view.dispatchEvent(new Event(WEBVIEW_SITE_PRIVACY_CHANGE_EVENT));
      });
    },
  });
};

describe("useSitePrivacy", () => {
  it("reads what the page already reports", () => {
    const view = viewReporting(NYTIMES);

    const { result } = renderHook(() => useSitePrivacy(view));

    expect(result.current).toStrictEqual({
      blocked: 23,
      mode: "standard",
      setFor: "profile",
      site: "nytimes.com",
    });
  });

  it("follows each change", () => {
    const view = viewReporting(NYTIMES);
    const { result } = renderHook(() => useSitePrivacy(view));

    view.report({
      ...NYTIMES,
      blockAdsAndTrackers: "off",
      blockAdsAndTrackersSetFor: "window",
      blockedCount: 0,
    });

    expect(result.current).toStrictEqual({
      blocked: 0,
      mode: "off",
      setFor: "window",
      site: "nytimes.com",
    });
  });

  it("has nothing for a page that is never blocked", () => {
    const view = viewReporting({
      blockAdsAndTrackers: "",
      blockAdsAndTrackersSetFor: "",
      blockedCount: 0,
      privacySite: "",
    });

    const { result } = renderHook(() => useSitePrivacy(view));

    expect(result.current).toBeUndefined();
  });

  it("has nothing for a mode it doesn't know", () => {
    const view = viewReporting({ ...NYTIMES, blockAdsAndTrackers: "extreme" });
    const logged = spyOn(console, "error").mockImplementation(() => {
      /* asserted below */
    });

    const { result } = renderHook(() => useSitePrivacy(view));

    expect(result.current).toBeUndefined();
    expect(logged.mock.calls[0]?.[0]).toBe(
      "The page reported ad blocking the shell doesn't know",
    );
    logged.mockRestore();
  });

  it("has nothing from an engine without ad blocking", () => {
    const view = document.createElement("webview");

    const { result } = renderHook(() => useSitePrivacy(view));

    expect(result.current).toBeUndefined();
  });

  it("has nothing without a view", () => {
    const { result } = renderHook(() => useSitePrivacy(null));

    expect(result.current).toBeUndefined();
  });
});
