import { describe, expect, it } from "bun:test";
import type { DomicileTrayItem } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useTray } from "./useTray";

/** A host whose tray the test says. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    domicile: fake.host,
    says: (items: readonly DomicileTrayItem[]) => {
      act(() => {
        fake.set({ tray: items });
      });
    },
  };
};

const icon = (id: string): DomicileTrayItem => ({ icon: "", id, title: id });

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
