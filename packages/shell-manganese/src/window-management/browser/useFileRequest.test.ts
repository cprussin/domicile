import { describe, expect, it } from "bun:test";
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { ChooserMode } from "./file-request";
import { useFileRequest } from "./useFileRequest";

/**
 * The engine asking the view for a file, with every answer it is given kept
 * in order. Built rather than constructed, because the event's own type is the
 * fork's and no DOM these tests run on has it. Cancelable, because taking it is
 * `preventDefault()`.
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
      mode,
      suggestedName: "",
    },
  );
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe("useFileRequest", () => {
  // One nobody takes, the engine cancels as the dispatch returns: this is the
  // shell saying it will answer.
  it("takes the page's question", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useFileRequest(view));

    const event = asks(view, "open", []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current?.mode).toBe(ChooserMode.Open);
  });

  it("answers it once, and has no question left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useFileRequest(view));
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
    const { result } = renderHook(() => useFileRequest(view));
    asks(view, "open", answers);

    act(() => {
      result.current?.cancel();
    });

    expect(answers).toStrictEqual(["cancel open"]);
    expect(result.current).toBeUndefined();
  });

  // A page can only wait on one picker it can see, and the newer question is
  // the one the user just caused.
  it("cancels the question it was holding when another arrives", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useFileRequest(view));

    asks(view, "open", answers);
    asks(view, "save", answers);

    expect(answers).toStrictEqual(["cancel open"]);
    expect(result.current?.mode).toBe(ChooserMode.Save);
  });

  // A page left waiting on a window that is gone waits forever.
  it("cancels the question it was holding when it goes", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { unmount } = renderHook(() => useFileRequest(view));
    asks(view, "open", answers);

    unmount();

    expect(answers).toStrictEqual(["cancel open"]);
  });

  it("asks nothing of a window with no view yet", () => {
    const { result } = renderHook(() => useFileRequest(null));

    expect(result.current).toBeUndefined();
  });
});
