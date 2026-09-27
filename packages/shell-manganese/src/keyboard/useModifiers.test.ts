import { afterEach, describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { useModifiers } from "./useModifiers";

const HELD = { altKey: false, ctrlKey: false, metaKey: true, shiftKey: false };

/**
 * A stand-in for the client: it takes the handler the hook registers and lets
 * a test say what the host said. Narrower than a `DomicileClient` because the
 * hook uses two of its members.
 */
const client = () => {
  const handlers = new Map<string, (message: never) => void>();
  const domicile = {
    off: (type: string) => {
      handlers.delete(type);
    },
    on: (type: string, registered: (message: never) => void) => {
      handlers.set(type, registered);
    },
  } as unknown as DomicileClient;
  return {
    domicile,
    /** The host saying which modifiers are held. */
    says: (held: typeof HELD) => {
      act(() => {
        handlers.get("modifiers")?.(held as never);
      });
    },
  };
};

/**
 * A browser window's page taking the keyboard, which is its `<webview>` being
 * the shell document's `activeElement` — see `BrowserWindow`.
 */
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
    // The page is a guest with a document of its own, so this page hears none
    // of its keys: the engine reports what the guest holds instead.
    const { domicile, says } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    focusBrowserWindow();
    says(HELD);
    expect(result.current.modifiers).toEqual({ meta: true, shift: false });
  });

  it("does not take it while this page has the keyboard", () => {
    // The compositor's copy of this page's own keys, which is short every key
    // pressed while no client held the keyboard — see the hook.
    const { domicile, says } = client();
    const { result } = renderHook(() => useModifiers(domicile));
    act(() => {
      fireEvent.keyDown(document, { key: "Meta", metaKey: true });
    });
    says({ ...HELD, metaKey: false });
    expect(result.current.modifiers).toEqual({ meta: true, shift: false });
  });
});
