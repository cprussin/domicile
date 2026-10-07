import { describe, expect, it } from "bun:test";
import type { PortalHost } from "@domicile-desktop/sdk/portal";
import { act, renderHook } from "@testing-library/react";

import { usePortalWallpaper } from "./usePortalWallpaper";

/** A desktop that pushes `portal_requests` lines. */
class FakeHost implements PortalHost {
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(): void {
    throw new Error("nothing answers in these tests");
  }

  addEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  push(wallpaper: object): void {
    const data = JSON.stringify({
      items: [],
      type: "portal_requests",
      wallpaper,
    });
    act(() => {
      for (const listener of this.#listeners) {
        listener(new MessageEvent("portalrequests", { data }));
      }
    });
  }
}

describe("usePortalWallpaper", () => {
  it("is nothing set until the desktop says", () => {
    const { result } = renderHook(() => usePortalWallpaper(new FakeHost()));

    expect(result.current).toEqual({
      background: undefined,
      lockscreen: undefined,
    });
  });

  it("is the pictures the desktop pushed", () => {
    const host = new FakeHost();
    const { result } = renderHook(() => usePortalWallpaper(host));
    host.push({ lockscreen: "/state/lockscreen-1.png" });

    expect(result.current).toEqual({
      background: undefined,
      lockscreen: "/state/lockscreen-1.png",
    });
  });
});
