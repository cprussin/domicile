import { describe, expect, it } from "bun:test";
import type { DomicileClipboardEntry } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useClipboard } from "./useClipboard";

/** A fake host whose clipboard a test sets. */
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
    // Normal after startup; the panel shows its own empty line.
    const host = client();

    const { result } = renderHook(() => useClipboard(host.domicile));

    expect(result.current).toEqual([]);
  });

  it("is what was last said, whole", () => {
    // Each message is the full history, since a copy can reorder the list.
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
    // An empty history is a real answer; treating it as "not yet told" would
    // keep showing removed rows.
    const host = client();
    const { result } = renderHook(() => useClipboard(host.domicile));

    host.says([{ id: 1, preview: "first" }]);
    host.says([]);

    expect(result.current).toEqual([]);
  });
});
