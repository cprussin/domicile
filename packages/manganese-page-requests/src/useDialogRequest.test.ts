import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_DIALOG_EVENT,
  WEBVIEW_DIALOG_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useDialogRequest } from "./useDialogRequest";

/**
 * A fake engine dialog, recording its answers. Built by hand because the test
 * DOM lacks the engine's event type; cancelable because claiming it is
 * `preventDefault()`.
 */
const opens = (
  view: HTMLElement,
  dialogType: string,
  answers: string[],
): DomicileDialogEvent => {
  const event = Object.assign(
    new Event(WEBVIEW_DIALOG_EVENT, { cancelable: true }),
    {
      accept: (value?: string) => {
        answers.push(`accept ${value ?? ""}`);
      },
      defaultValue: "Ada",
      dialogType,
      dismiss: () => {
        answers.push("dismiss");
      },
      message: "Your name?",
      origin: "https://example.com",
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe("useDialogRequest", () => {
  // The engine dismisses unclaimed dialogs when dispatch returns.
  it("takes the page's dialog", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useDialogRequest(view));

    const event = opens(view, "prompt", []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current).toMatchObject({
      defaultValue: "Ada",
      message: "Your name?",
      origin: "https://example.com",
      type: "prompt",
    });
  });

  it("takes a page's beforeunload", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useDialogRequest(view));

    const event = opens(view, "beforeunload", []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current?.type).toBe("beforeunload");
  });

  it("answers it once, and has no dialog left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDialogRequest(view));
    opens(view, "prompt", answers);

    act(() => {
      result.current?.accept("Grace");
    });

    expect(answers).toStrictEqual(["accept Grace"]);
    expect(result.current).toBeUndefined();
  });

  it("dismisses it", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDialogRequest(view));
    opens(view, "confirm", answers);

    act(() => {
      result.current?.dismiss();
    });

    expect(answers).toStrictEqual(["dismiss"]);
    expect(result.current).toBeUndefined();
  });

  it("drops a dialog the browser withdrew", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDialogRequest(view));
    opens(view, "alert", answers);

    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_DIALOG_WITHDRAWN_EVENT));
    });

    expect(result.current).toBeUndefined();
    expect(answers).toStrictEqual([]);
  });
});
