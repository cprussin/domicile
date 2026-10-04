import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { HostMessageOf } from "@domicile-desktop/sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useClipboard } from "./useClipboard";

/**
 * A minimal client: it captures the hook's one handler and lets a test emit
 * messages. Narrower than `DomicileClient` because the hook uses one member.
 */
const client = () => {
  let handler: ((message: HostMessageOf<"clipboard">) => void) | undefined;
  const domicile = {
    on: (
      _type: "clipboard",
      registered: (message: HostMessageOf<"clipboard">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    domicile,
    says: (entries: HostMessageOf<"clipboard">["entries"]) => {
      act(() => {
        handler?.({ entries });
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
