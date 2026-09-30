import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { HostMessageOf } from "@domicile/chrome-sdk/host-message";
import type { TrayItem } from "@domicile/chrome-sdk/tray";
import { act, renderHook } from "@testing-library/react";

import { useTray } from "./useTray";

/**
 * A stand-in for the client that takes the one handler this hook registers and
 * lets a test say what the compositor said. Narrow for `useClipboard`'s reason.
 */
const client = () => {
  let handler: ((message: HostMessageOf<"tray">) => void) | undefined;
  const domicile = {
    on: (
      _type: "tray",
      registered: (message: HostMessageOf<"tray">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    domicile,
    says: (items: readonly TrayItem[]) => {
      act(() => {
        handler?.({ items });
      });
    },
  };
};

const icon = (id: string): TrayItem => ({ icon: undefined, id, title: id });

describe("useTray", () => {
  it("has no icons until the compositor has said", () => {
    const host = client();

    const { result } = renderHook(() => useTray(host.domicile));

    expect(result.current).toEqual([]);
  });

  it("is the tray last said, whole", () => {
    // Every change is the whole tray, so an application that went is gone by
    // being left out rather than by a message of its own.
    const host = client();
    const { result } = renderHook(() => useTray(host.domicile));

    host.says([icon(":1.9/a"), icon(":1.42/b")]);
    host.says([icon(":1.42/b")]);

    expect(result.current).toEqual([icon(":1.42/b")]);
  });
});
