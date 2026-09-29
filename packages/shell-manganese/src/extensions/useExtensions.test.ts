import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import type { HostMessageOf } from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useExtensions } from "./useExtensions";

/**
 * A stand-in for the client that takes the one handler this hook registers and
 * lets a test say what the engine said. Narrow for `useClipboard`'s reason.
 */
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
    // Every change is the whole list, so an extension the config dropped is
    // gone by leaving it out rather than by a message of its own.
    const host = client();
    const { result } = renderHook(() => useExtensions(host.domicile));

    host.says([extension(FIRST), extension(SECOND)]);
    host.says([extension(SECOND)]);

    expect(result.current).toEqual([extension(SECOND)]);
  });
});
