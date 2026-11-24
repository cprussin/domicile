import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useAppWindowLooks } from "./useAppWindowLooks";

describe("useAppWindowLooks", () => {
  it("asks for nothing of a window whose app asks nothing", () => {
    const host = new FakeDomicileHost();
    host.openBrowser("https://claude.test/");

    const { result } = renderHook(() => useAppWindowLooks(host.domicile, "1"));

    expect(result.current).toEqual({
      clipPath: undefined,
      ignoresPointer: false,
      urgent: false,
    });
  });

  it("follows what the app asks of its window", () => {
    const host = new FakeDomicileHost();
    host.openBrowser("https://claude.test/");
    const { result } = renderHook(() => useAppWindowLooks(host.domicile, "1"));

    act(() => {
      host.setLooks("1", {
        ignoresPointer: true,
        shape: JSON.stringify([{ height: 4, width: 3, x: 1, y: 2 }]),
        urgent: true,
      });
    });

    expect(result.current).toEqual({
      clipPath: 'path("M1 2h3v4h-3Z")',
      ignoresPointer: true,
      urgent: true,
    });
  });
});
