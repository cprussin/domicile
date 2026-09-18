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

  // THE SAME CASE AS THE ONE ABOVE, AS THE ENGINE ACTUALLY DELIVERS IT, and
  // the difference is the whole of this: `focusout` is dispatched from inside
  // the focus change, with the focus off the element that had it and not yet
  // on the one taking it, so the body is what `document.activeElement` answers
  // for the length of that dispatch. Deferring the read does not get past it —
  // the engine runs the microtask checkpoint as soon as a listener called from
  // its own dispatch returns, which is still inside the change. Happy-dom
  // settles the focus first and so cannot show this: the case above passes
  // either way.
  //
  // What it cost: a window took the focus back off its own address bar on the
  // press that reached for it, and Blink treats a handler that moves the focus
  // mid-change as a refusal — so the bar could not be clicked into at all.
  it("leaves a focus that is on its way to another element alone", async () => {
    const view = page();
    const reaching = control();
    // What the window was asked for rather than where the focus ended up: the
    // engine's own state during this dispatch is a document with nothing
    // focused, and a double that leaves it that way is what holds the case
    // still long enough to ask the question twice.
    const asked: Element[] = [];
    renderHook(() => {
      useReclaimFocus(view, true, (element) => {
        asked.push(element);
      });
    });
    // The mount finds a document with nothing focused at all, which is this
    // hook's own case and not the one under test.
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
