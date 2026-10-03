import { describe, expect, it } from "bun:test";
import { WEBVIEW_FIND_CHANGE_EVENT } from "@domicile/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useFindResult } from "./useFindResult";

/**
 * A stand-in for the fork's element: the count a chrome reads, and the event
 * that tells it to read it again. `defineProperties` because both are readonly
 * on the real element — what a find found is the browser's answer.
 */
const guest = () => {
  const element = document.createElement("webview");
  const found = (matches: number, activeMatch: number) => {
    Object.defineProperties(element, {
      findActiveMatch: { configurable: true, value: activeMatch },
      findMatches: { configurable: true, value: matches },
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_FIND_CHANGE_EVENT));
    });
  };
  found(0, 0);
  return { changed, element, found };
};

describe("useFindResult", () => {
  it("reads what the view has found as it mounts, having heard nothing", () => {
    const view = guest();
    view.found(4, 2);
    const { result } = renderHook(() => useFindResult(view.element));
    expect(result.current).toStrictEqual({ activeMatch: 2, matches: 4 });
  });

  it("reads it again when the view says it changed", () => {
    const view = guest();
    const { result } = renderHook(() => useFindResult(view.element));
    view.found(7, 1);
    view.changed();
    expect(result.current).toStrictEqual({ activeMatch: 1, matches: 7 });
  });

  it("says a window with no view yet has found nothing", () => {
    const { result } = renderHook(() => useFindResult(null));
    expect(result.current).toStrictEqual({ activeMatch: 0, matches: 0 });
  });
});
