import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_PERMISSION_REQUEST_EVENT,
  WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePermissionRequest } from "./usePermissionRequest";

/**
 * A fake engine permission request, recording its answers. Built by hand
 * because the test DOM lacks the engine's event type; cancelable because
 * claiming it is `preventDefault()`.
 */
const asks = (
  view: HTMLElement,
  permissions: readonly string[],
  answers: string[],
): DomicilePermissionRequestEvent => {
  const event = Object.assign(
    new Event(WEBVIEW_PERMISSION_REQUEST_EVENT, { cancelable: true }),
    {
      allow: () => {
        answers.push("allow");
      },
      deny: () => {
        answers.push("deny");
      },
      dismiss: () => {
        answers.push("dismiss");
      },
      origin: "https://meet.example.com",
      permissions,
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe("usePermissionRequest", () => {
  // The engine ignores unclaimed requests when dispatch returns.
  it("takes the page's request", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => usePermissionRequest(view));

    const event = asks(view, ["camera", "microphone"], []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current?.origin).toBe("https://meet.example.com");
    expect(result.current?.permissions).toStrictEqual(["camera", "microphone"]);
  });

  it("answers it once, and has no request left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePermissionRequest(view));
    asks(view, ["camera"], answers);

    act(() => {
      result.current?.allow();
    });

    expect(answers).toStrictEqual(["allow"]);
    expect(result.current).toBeUndefined();
  });

  it("drops a request the browser withdrew", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePermissionRequest(view));
    asks(view, ["camera"], answers);

    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT));
    });

    expect(result.current).toBeUndefined();
    expect(answers).toStrictEqual([]);
  });
});
