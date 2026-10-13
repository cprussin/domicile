import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
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
  mock.restore();
});

describe("useReclaimFocus", () => {
  // A pressed close button is unmounted with its window, possibly with no
  // redraw of this one. Removal fires no focus event.
  it("takes it back when whatever held it was taken off the page", async () => {
    const view = page();
    const pressed = control();
    renderHook(() => {
      useReclaimFocus(view, true, focusIt);
    });
    pressed.focus();
    expect(document.activeElement).toBe(pressed);

    pressed.remove();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.activeElement).toBe(view);
  });

  // Unlocking makes the lock screen inert, which drops its focus with no event
  // and no redraw of the window.
  it("looks again when part of the page goes inert", async () => {
    const view = page();
    const sheet = control();
    // Record `take` calls without focusing, so focus stays on nothing.
    const asked: Element[] = [];
    renderHook(() => {
      useReclaimFocus(view, true, (element) => {
        asked.push(element);
      });
    });

    sheet.inert = true;
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(asked).toStrictEqual([view, view]);
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

  // Every window has the hook, so only the selected one listens.
  it("listens to the document only while its window is selected", () => {
    const view = page();
    const listening = spyOn(document, "addEventListener");
    const { rerender } = renderHook(
      ({ focused }) => {
        useReclaimFocus(view, focused, focusIt);
      },
      { initialProps: { focused: false } },
    );
    const added = () =>
      listening.mock.calls.filter(([type]) => type === "focusout").length;
    expect(added()).toBe(0);

    rerender({ focused: true });

    expect(added()).toBe(1);
  });

  it("stays out of it while the user is working in another window", () => {
    const view = page();
    renderHook(() => {
      useReclaimFocus(view, false, focusIt);
    });
    expect(document.activeElement).not.toBe(view);
  });
});
