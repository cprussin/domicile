import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_PAGE_FAILURE_CHANGE_EVENT,
  WEBVIEW_RENDER_PROCESS_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePageProblem } from "./usePageProblem";

/** Sets the element's readonly attributes, as the engine does. */
const set = (view: HTMLElement, values: Record<string, unknown>): void => {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(view, name, { configurable: true, value });
  }
};

const fails = (view: HTMLWebViewElement, error: string): void => {
  set(view, {
    pageFailure: "network",
    pageFailureCanProceed: false,
    pageFailureError: error,
    pageFailureHttpStatus: 0,
    pageFailureUrl: "https://example.invalid/",
  });
  act(() => {
    view.dispatchEvent(new Event(WEBVIEW_PAGE_FAILURE_CHANGE_EVENT));
  });
};

const view = () => document.createElement("webview") as HTMLWebViewElement;

describe("usePageProblem", () => {
  it("has none while the page loads", () => {
    const { result } = renderHook(() => usePageProblem(view()));

    expect(result.current).toBeUndefined();
  });

  it("reads a failed load", () => {
    const shown = view();
    const { result } = renderHook(() => usePageProblem(shown));

    fails(shown, "ERR_NAME_NOT_RESOLVED");

    expect(result.current).toStrictEqual({
      canProceed: false,
      error: "ERR_NAME_NOT_RESOLVED",
      httpStatus: 0,
      kind: "network",
      url: "https://example.invalid/",
    });
  });

  it("clears once a page loads", () => {
    const shown = view();
    const { result } = renderHook(() => usePageProblem(shown));
    fails(shown, "ERR_NAME_NOT_RESOLVED");

    set(shown, { pageFailure: "" });
    act(() => {
      shown.dispatchEvent(new Event(WEBVIEW_PAGE_FAILURE_CHANGE_EVENT));
    });

    expect(result.current).toBeUndefined();
  });

  it("puts a crash before a failure", () => {
    const shown = view();
    const { result } = renderHook(() => usePageProblem(shown));
    fails(shown, "ERR_NAME_NOT_RESOLVED");

    set(shown, { renderProcessGone: "crashed" });
    act(() => {
      shown.dispatchEvent(new Event(WEBVIEW_RENDER_PROCESS_CHANGE_EVENT));
    });

    expect(result.current).toStrictEqual({ kind: "gone", reason: "crashed" });
  });
});
