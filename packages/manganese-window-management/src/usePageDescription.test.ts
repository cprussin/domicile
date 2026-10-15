import { describe, expect, it } from "bun:test";
import { WEBVIEW_DESCRIPTION_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePageDescription } from "./usePageDescription";

/**
 * A fake `<webview>` with `description` and its change event.
 * `defineProperty` because `description` is readonly on the real element.
 */
const guest = (description: string) => {
  const element = document.createElement("webview");
  const describes = (now: string) => {
    Object.defineProperty(element, "description", {
      configurable: true,
      value: now,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_DESCRIPTION_CHANGE_EVENT));
    });
  };
  describes(description);
  return { changed, describes, element };
};

describe("usePageDescription", () => {
  it("reports the page's description with its window as it mounts", async () => {
    const view = guest("Rust documentation");
    const reported = await new Promise<[string, string]>((resolve) => {
      renderHook(() =>
        usePageDescription(view.element, "7", (window, description) => {
          resolve([window, description]);
        }),
      );
    });
    expect(reported).toEqual(["7", "Rust documentation"]);
  });

  it("reports it again when the view says it changed", () => {
    const view = guest("");
    const reports: string[] = [];
    renderHook(() =>
      usePageDescription(view.element, "7", (_window, description) => {
        reports.push(description);
      }),
    );
    view.describes("Rust documentation");
    view.changed();
    expect(reports).toEqual(["", "Rust documentation"]);
  });

  it("stops listening when it unmounts", () => {
    const view = guest("");
    const reports: string[] = [];
    const { unmount } = renderHook(() =>
      usePageDescription(view.element, "7", (_window, description) => {
        reports.push(description);
      }),
    );
    unmount();
    view.describes("Rust documentation");
    view.changed();
    expect(reports).toEqual([""]);
  });
});
