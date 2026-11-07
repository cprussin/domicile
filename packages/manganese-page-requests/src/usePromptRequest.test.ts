import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_PROMPT_EVENT,
  WEBVIEW_PROMPT_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePromptRequest } from "./usePromptRequest";

/**
 * A fake engine request, recording its answers. Built by hand because the
 * test DOM lacks the engine's event type; cancelable because claiming it is
 * `preventDefault()`.
 */
const asks = (view: HTMLElement, answers: string[]): DomicilePromptEvent => {
  const event = Object.assign(
    new Event(WEBVIEW_PROMPT_EVENT, { cancelable: true }),
    {
      accept: (choice = 0, text = "") => {
        answers.push(`accept ${choice} ${text}`);
      },
      details: ["Ada\nExample CA", "Ada (work)\nWork CA"],
      dismiss: () => {
        answers.push("dismiss");
      },
      kind: "client-certificate" as const,
      origin: "https://intranet.example",
      pin: "",
      subject: "",
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe("usePromptRequest", () => {
  // The engine answers unclaimed requests no when dispatch returns.
  it("takes the page's request", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => usePromptRequest(view));

    const event = asks(view, []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current).toMatchObject({
      details: ["Ada\nExample CA", "Ada (work)\nWork CA"],
      kind: "client-certificate",
      origin: "https://intranet.example",
    });
  });

  it("accepts once with the choice and has no request left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePromptRequest(view));
    asks(view, answers);

    act(() => {
      result.current?.accept(1);
    });

    expect(answers).toStrictEqual(["accept 1 "]);
    expect(result.current).toBeUndefined();
  });

  it("dismisses it", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePromptRequest(view));
    asks(view, answers);

    act(() => {
      result.current?.dismiss();
    });

    expect(answers).toStrictEqual(["dismiss"]);
    expect(result.current).toBeUndefined();
  });

  it("drops a request the browser withdrew", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePromptRequest(view));
    asks(view, answers);

    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_PROMPT_WITHDRAWN_EVENT));
    });

    expect(result.current).toBeUndefined();
    expect(answers).toStrictEqual([]);
  });
});
