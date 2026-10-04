import { afterEach, describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { useReclaimFocus } from "./useReclaimFocus";

/** The element the window keeps focused, such as a browser page. */
const page = (): HTMLElement => appended(document.createElement("webview"));

/** A focusable chrome control. */
const control = (): HTMLElement => appended(document.createElement("button"));

/**
 * A plain `focus()`. Real windows pass their own `take` (see
 * `BrowserWindow`).
 */
const focusIt = (element: HTMLElement) => {
  element.focus();
};

const appended = (element: HTMLElement): HTMLElement => {
  document.body.append(element);
  return element;
};

/** Waits for focus to settle after a `focusout`. */
const settled = () => act(() => Promise.resolve());

afterEach(() => {
  document.body.replaceChildren();
});

describe("useReclaimFocus", () => {
  // A pressed close button is unmounted with its window. Removal fires no
  // focus event, so only the re-render reveals focus landing on nothing.
  it("takes it back when whatever held it was taken off the page", async () => {
    const view = page();
    const pressed = control();
    const { rerender } = renderHook(() => {
      useReclaimFocus(view, true, focusIt);
    });
    pressed.focus();
    expect(document.activeElement).toBe(pressed);

    pressed.remove();
    await act(() => {
      rerender();
      return Promise.resolve();
    });

    expect(document.activeElement).toBe(view);
  });

  it("takes it back when a press lands on nothing that can hold it", async () => {
    const view = page();
    const pressed = control();
    renderHook(() => {
      useReclaimFocus(view, true, focusIt);
    });
    pressed.focus();

    act(() => {
      pressed.blur();
    });
    await settled();

    expect(document.activeElement).toBe(view);
  });

  // Chrome controls such as the address bar take focus on purpose and must
  // keep it.
  it("leaves the focus where the chrome deliberately put it", async () => {
    const view = page();
    const reached = control();
    renderHook(() => {
      useReclaimFocus(view, true, focusIt);
    });

    act(() => {
      reached.focus();
    });
    await settled();

    expect(document.activeElement).toBe(reached);
  });

  // The case above as Blink delivers it: during `focusout` the active element
  // is `body`, even in a microtask. Happy-dom settles focus first, so the case
  // above cannot show this. Reclaiming here would stop the address bar from
  // taking focus.
  it("leaves a focus that is on its way to another element alone", async () => {
    const view = page();
    const reaching = control();
    // Record `take` calls without focusing, so the document stays unfocused as
    // it is in Blink during the dispatch.
    const asked: Element[] = [];
    renderHook(() => {
      useReclaimFocus(view, true, (element) => {
        asked.push(element);
      });
    });
    // The mount reclaims from an unfocused document; that is not under test.
    expect(asked).toStrictEqual([view]);

    act(() => {
      view.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: reaching }),
      );
    });
    await settled();

    expect(asked).toStrictEqual([view]);
  });

  it("stays out of it while the user is working in another window", () => {
    const view = page();
    renderHook(() => {
      useReclaimFocus(view, false, focusIt);
    });
    expect(document.activeElement).not.toBe(view);
  });
});
