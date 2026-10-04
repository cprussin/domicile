import { describe, expect, it } from "bun:test";
import type { DomicileClipboardEntry } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useClipboard } from "./useClipboard";

/** A host whose clipboard the test says. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    domicile: fake.host,
    says: (entries: readonly DomicileClipboardEntry[]) => {
      act(() => {
        fake.set({ clipboard: entries });
      });
    },
  };
};

describe("useClipboard", () => {
  it("has nothing until the compositor has said something", () => {
    // Which is a moment rather than a state worth drawing: a desktop that has
    // just started has copied nothing, and the panel's own empty line is what
    // says so.
    const host = client();

    const { result } = renderHook(() => useClipboard(host.domicile));

    expect(result.current).toEqual([]);
  });

  it("is what was last said, whole", () => {
    // The whole history every time rather than a delta: a copy re-orders the
    // list as often as it adds to it, so the last message is the answer and
    // the one before it is not part of it.
    const host = client();
    const { result } = renderHook(() => useClipboard(host.domicile));

    host.says([{ id: 1, preview: "first" }]);
    host.says([
      { id: 2, preview: "second" },
      { id: 1, preview: "first" },
    ]);

    expect(result.current).toEqual([
      { id: 2, preview: "second" },
      { id: 1, preview: "first" },
    ]);
  });

  it("takes an emptied history as an answer", () => {
    // Not "nothing was said": the compositor sends a history with no rows in
    // it, and a panel that read that as "not told yet" would go on drawing
    // rows that are gone.
    const host = client();
    const { result } = renderHook(() => useClipboard(host.domicile));

    host.says([{ id: 1, preview: "first" }]);
    host.says([]);

    expect(result.current).toEqual([]);
  });
});
