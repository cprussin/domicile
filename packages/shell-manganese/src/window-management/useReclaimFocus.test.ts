import { afterEach, describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { useReclaimFocus } from "./useReclaimFocus";

/** The element the window wants focused: a browser window's page, in practice. */
const page = (): HTMLElement => appended(document.createElement("webview"));

/** Something of the chrome around it that can hold the focus of its own. */
const control = (): HTMLElement => appended(document.createElement("button"));

/**
 * What taking the focus back means here: the DOM call, plainly. A real window
 * has more to say about its own — see `BrowserWindow` — which is why the hook
 * is told rather than calling `focus()` itself.
 */
const focusIt = (element: HTMLElement) => {
  element.focus();
};

const appended = (element: HTMLElement): HTMLElement => {
  document.body.append(element);
  return element;
};

/**
 * The focus settling where the press left it, which is a moment later than the
 * `focusout` that announced it leaving.
 */
const settled = () => act(() => Promise.resolve());

afterEach(() => {
  document.body.replaceChildren();
});

describe("useReclaimFocus", () => {
  // THE ONE CLOSING A TAB LEAVES BEHIND. A control that is pressed takes the
  // focus and then goes away with the window it closed, and an element removed
  // from the document dispatches no focus event at all — so the only sign of
  // the focus landing on nothing is the render that took the control off the
  // page.
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

  // The chrome is full of things that take the focus on purpose, and every one
  // of them is the user reaching for it: the address bar over the page, a tab
  // on the top bar, the theme switch. A window that took the focus back from those
  // is a window whose address bar cannot be typed in.
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

  it("stays out of it while the user is working in another window", () => {
    const view = page();
    renderHook(() => {
      useReclaimFocus(view, false, focusIt);
    });
    expect(document.activeElement).not.toBe(view);
  });
});
