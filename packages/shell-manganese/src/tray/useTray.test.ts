import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { HostMessageOf } from "@domicile-desktop/sdk/host-message";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { act, renderHook } from "@testing-library/react";

import { useTray } from "./useTray";

/**
 * A client stub that captures the hook's handler and lets a test send
 * compositor messages.
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
    // Each update is the whole tray, so a removed icon is simply absent.
    const host = client();
    const { result } = renderHook(() => useTray(host.domicile));

    host.says([icon(":1.9/a"), icon(":1.42/b")]);
    host.says([icon(":1.42/b")]);

    expect(result.current).toEqual([icon(":1.42/b")]);
  });
});
