import { afterEach, describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { useModifiers } from "./useModifiers";

const HELD = { altKey: false, ctrlKey: false, metaKey: true, shiftKey: false };

/** A fake host whose modifiers a test sets. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    domicile: fake.host,
    /** Set the held modifiers. */
    says: (held: typeof HELD) => {
      act(() => {
        fake.set(held);
      });
    },
  };
};

/** Focus a `<webview>`, as a browser window does (see `BrowserWindow`). */
const focusBrowserWindow = (): void => {
  const view = document.createElement("webview");
  view.tabIndex = 0;
  document.body.append(view);
  view.focus();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("useModifiers", () => {
  it("follows this page's own keys", () => {
    const { domicile } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    act(() => {
      fireEvent.keyDown(document, { key: "Meta", metaKey: true });
    });
    expect(result.current.modifiers).toEqual({ meta: true, shift: false });
  });

  it("takes the host's word while a browser window's page has the keyboard", () => {
    // This page gets no key events from the guest, so the engine reports its
    // modifiers.
    const { domicile, says } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    focusBrowserWindow();
    says(HELD);
    expect(result.current.modifiers).toEqual({ meta: true, shift: false });
  });

  it("lets go of everything when the desktop's window loses the keyboard", () => {
    // This page gets no keyup while the host has the keyboard.
    const { domicile } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    act(() => {
      fireEvent.keyDown(document, { key: "Meta", metaKey: true });
      fireEvent.blur(window);
    });
    expect(result.current.modifiers).toEqual({ meta: false, shift: false });
  });

  it("reads what is held off the pointer as well as the keys", () => {
    // Pointer events carry modifier state, so they correct a missed release.
    const { domicile } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    act(() => {
      fireEvent.keyDown(document, { key: "Meta", metaKey: true });
      fireEvent.pointerMove(document, { metaKey: false, shiftKey: false });
    });
    expect(result.current.modifiers).toEqual({ meta: false, shift: false });
  });

  it("does not take it while this page has the keyboard", () => {
    // The compositor's state misses keys pressed while no client had the
    // keyboard (see the hook).
    const { domicile, says } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    act(() => {
      fireEvent.keyDown(document, { key: "Meta", metaKey: true });
    });
    says({ ...HELD, metaKey: false });
    expect(result.current.modifiers).toEqual({ meta: true, shift: false });
  });
});
