import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_PICKER_EVENT,
  WEBVIEW_PICKER_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePickerRequest } from "./usePickerRequest";

/**
 * A fake engine picker, recording its answers. Built by hand because the test
 * DOM lacks the engine's event type.
 */
const opens = (view: HTMLElement, answers: string[]): DomicilePickerEvent => {
  const event = Object.assign(
    new Event(WEBVIEW_PICKER_EVENT, { cancelable: true }),
    {
      anchorHeight: 24,
      anchorWidth: 120,
      anchorX: 10,
      anchorY: 40,
      cancel: () => {
        answers.push("cancel");
      },
      choose: (value: string) => {
        answers.push(`choose ${value}`);
      },
      kind: "list" as const,
      labels: ["", "Firefox's engine"],
      max: "",
      min: "",
      options: ["Blink", "Gecko"],
      step: "",
      value: "B",
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe("usePickerRequest", () => {
  it("takes the page's picker, with its options and box", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => usePickerRequest(view));

    const event = opens(view, []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current).toMatchObject({
      anchor: { height: 24, width: 120, x: 10, y: 40 },
      kind: "list",
      options: [
        { label: "", value: "Blink" },
        { label: "Firefox's engine", value: "Gecko" },
      ],
      value: "B",
    });
  });

  it("chooses once and has no picker left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => usePickerRequest(view));
    opens(view, answers);

    act(() => {
      result.current?.choose("Gecko");
    });

    expect(answers).toStrictEqual(["choose Gecko"]);
    expect(result.current).toBeUndefined();
  });

  it("drops the picker the page withdrew", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => usePickerRequest(view));
    opens(view, []);

    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_PICKER_WITHDRAWN_EVENT));
    });

    expect(result.current).toBeUndefined();
  });
});
