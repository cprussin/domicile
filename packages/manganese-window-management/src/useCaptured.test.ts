import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useCaptured } from "./useCaptured";

describe("useCaptured", () => {
  it("follows the engine's capture of a browser window's page", () => {
    const fake = new FakeDomicileHost();
    fake.domicile.browser.open("https://example.com");
    const { result } = renderHook(() => useCaptured(fake.domicile, "1"));
    expect(result.current).toBe(false);

    act(() => {
      fake.captureBrowser("1");
    });
    expect(result.current).toBe(true);

    act(() => {
      fake.captureBrowser("1", false);
    });
    expect(result.current).toBe(false);
  });

  it("is false for an app window, which the engine does not capture", () => {
    const fake = new FakeDomicileHost();
    fake.domicile.browser.open("https://example.com");
    fake.captureBrowser("1");

    const { result } = renderHook(() => useCaptured(fake.domicile, undefined));

    expect(result.current).toBe(false);
  });
});
