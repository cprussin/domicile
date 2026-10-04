import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import type { HostMessageOf } from "@domicile-desktop/sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useExtensions } from "./useExtensions";

/** Fake client that captures the hook's handler so a test can send messages. */
const client = () => {
  let handler: ((message: HostMessageOf<"extensions">) => void) | undefined;
  const domicile = {
    on: (
      _type: "extensions",
      registered: (message: HostMessageOf<"extensions">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    domicile,
    says: (extensions: readonly Extension[]) => {
      act(() => {
        handler?.({ extensions });
      });
    },
  };
};

const extension = (id: string): Extension => ({
  badgeColor: "#00000000",
  badgeText: "",
  enabled: true,
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id,
  name: id,
  popup: undefined,
  title: id,
});

const FIRST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("useExtensions", () => {
  it("has none until the engine has said", () => {
    const host = client();

    const { result } = renderHook(() => useExtensions(host.domicile));

    expect(result.current).toEqual([]);
  });

  it("is the list last said, whole", () => {
    // Each message carries the full list, so a removed extension is simply
    // absent.
    const host = client();
    const { result } = renderHook(() => useExtensions(host.domicile));

    host.says([extension(FIRST), extension(SECOND)]);
    host.says([extension(SECOND)]);

    expect(result.current).toEqual([extension(SECOND)]);
  });
});
