import { describe, expect, it } from "bun:test";
import type { DomicileTrayItem } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { act, renderHook } from "@testing-library/react";

import { useTray } from "./useTray";

/** A fake host whose tray a test sets. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    domicile: fake.domicile,
    says: (items: readonly DomicileTrayItem[]) => {
      act(() => {
        fake.set({ tray: items });
      });
    },
  };
};

const icon = (id: string): DomicileTrayItem => ({
  bus: ":1.9",
  icon: "",
  id,
  itemIsMenu: false,
  menu: "",
  title: id,
});

/** `icon(id)` as the tray reads it: no image and no menu. */
const shown = (id: string): TrayItem => ({
  bus: ":1.9",
  icon: undefined,
  id,
  itemIsMenu: false,
  menu: undefined,
  title: id,
});

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

    expect(result.current).toEqual([shown(":1.42/b")]);
  });
});
