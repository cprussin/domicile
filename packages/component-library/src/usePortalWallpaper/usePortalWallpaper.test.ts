import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { usePortalWallpaper } from "./usePortalWallpaper";

/** Push `wallpaper` from `fake`'s compositor. */
const push = (fake: FakeDomicileHost, wallpaper: object): void => {
  const data = JSON.stringify({
    items: [],
    type: "portal_requests",
    wallpaper,
  });
  act(() => {
    fake.dispatch("portalrequests", { data });
  });
};

describe("usePortalWallpaper", () => {
  it("is nothing set until the desktop says", () => {
    const fake = new FakeDomicileHost();
    const { result } = renderHook(() => usePortalWallpaper(fake.domicile));

    expect(result.current).toEqual({
      background: undefined,
      lockscreen: undefined,
    });
  });

  it("is the pictures the desktop pushed", () => {
    const fake = new FakeDomicileHost();
    const { result } = renderHook(() => usePortalWallpaper(fake.domicile));
    push(fake, { lockscreen: "/state/lockscreen-1.png" });

    expect(result.current).toEqual({
      background: undefined,
      lockscreen: "/state/lockscreen-1.png",
    });
  });
});
