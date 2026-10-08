import { describe, expect, it } from "bun:test";
import { WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useSitePermissions } from "./useSitePermissions";

/** A view reporting `reported`, as the engine's element would. */
const viewReporting = (
  reported: Record<string, string>,
): HTMLWebViewElement & { report: (next: Record<string, string>) => void } => {
  let current = reported;
  const view = document.createElement("webview");
  return Object.assign(view, {
    report: (next: Record<string, string>) => {
      current = next;
      act(() => {
        view.dispatchEvent(new Event(WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT));
      });
    },
    sitePermissions: () => current,
  });
};

describe("useSitePermissions", () => {
  it("reads what the page's site already has", () => {
    const view = viewReporting({ camera: "allow" });

    const { result } = renderHook(() => useSitePermissions(view));

    expect(result.current).toStrictEqual([
      { permission: "camera", setting: "allow" },
    ]);
  });

  it("follows each change", () => {
    const view = viewReporting({ camera: "allow" });
    const { result } = renderHook(() => useSitePermissions(view));

    view.report({ camera: "block" });

    expect(result.current).toStrictEqual([
      { permission: "camera", setting: "block" },
    ]);
  });

  it("has none from an engine without site permissions", () => {
    const view = document.createElement("webview");

    const { result } = renderHook(() => useSitePermissions(view));

    expect(result.current).toStrictEqual([]);
  });

  it("has none without a view", () => {
    const { result } = renderHook(() => useSitePermissions(null));

    expect(result.current).toStrictEqual([]);
  });
});
