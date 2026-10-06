import { describe, expect, it } from "bun:test";
import { ChooserMode } from "@domicile-desktop/component-library/file-request";
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";
import { useFileRequest } from "./useFileRequest";

/**
 * A fake engine file chooser event, recording its answers in order. Built by
 * hand because the test DOM lacks the engine's event type; cancelable because
 * claiming it is `preventDefault()`.
 */
const asks = (
  view: HTMLElement,
  mode: string,
  answers: string[],
): DomicileFileChooserEvent => {
  const event = Object.assign(
    new Event(WEBVIEW_FILE_CHOOSER_EVENT, { cancelable: true }),
    {
      accept: [],
      cancel: () => {
        answers.push(`cancel ${mode}`);
      },
      choose: (paths: readonly string[]) => {
        answers.push(`choose ${mode} ${paths.join(",")}`);
      },
      home: "/home/someone",
      mode,
      suggestedName: "",
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

/** A lister the picker never calls here. */
const NO_LIST = () => Promise.resolve([]);

describe("useFileRequest", () => {
  // The engine cancels unclaimed requests when dispatch returns.
  it("takes the page's question", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useFileRequest(view, NO_LIST));

    const event = asks(view, "open", []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current?.mode).toBe(ChooserMode.Open);
  });

  it("answers it once, and has no question left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useFileRequest(view, NO_LIST));
    asks(view, "open", answers);

    act(() => {
      result.current?.choose(["notes.txt"]);
    });

    expect(answers).toStrictEqual(["choose open notes.txt"]);
    expect(result.current).toBeUndefined();
  });

  it("has no question left once it is canceled either", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useFileRequest(view, NO_LIST));
    asks(view, "open", answers);

    act(() => {
      result.current?.cancel();
    });

    expect(answers).toStrictEqual(["cancel open"]);
    expect(result.current).toBeUndefined();
  });

  // Only one picker can show, and the newest request is the relevant one.
  it("cancels the question it was holding when another arrives", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useFileRequest(view, NO_LIST));

    asks(view, "open", answers);
    asks(view, "save", answers);

    expect(answers).toStrictEqual(["cancel open"]);
    expect(result.current?.mode).toBe(ChooserMode.Save);
  });

  // Otherwise the page would wait forever.
  it("cancels the question it was holding when it goes", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { unmount } = renderHook(() => useFileRequest(view, NO_LIST));
    asks(view, "open", answers);

    unmount();

    expect(answers).toStrictEqual(["cancel open"]);
  });

  it("asks nothing of a window with no view yet", () => {
    const { result } = renderHook(() => useFileRequest(null, NO_LIST));

    expect(result.current).toBeUndefined();
  });
});
