import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useBrowserProfile, useProfileMark } from "./useBrowserProfile";

const PERSONAL = {
  color: "#0d9488",
  id: "personal",
  isDefault: true,
  isDefaultPrivate: false,
  isPrivate: false,
  name: "Personal",
};

const WORK = {
  color: "#d97706",
  id: "work",
  isDefault: false,
  isDefaultPrivate: false,
  isPrivate: false,
  name: "Work",
};

describe("useBrowserProfile", () => {
  it("follows the profile a window's page is in", () => {
    const fake = new FakeDomicileHost();
    fake.set({ browserProfiles: [PERSONAL, WORK] });
    fake.domicile.browser.open("https://example.com");
    const { result } = renderHook(() => useBrowserProfile(fake.domicile, "1"));
    expect(result.current?.profile).toStrictEqual(PERSONAL);
    expect(result.current?.profiles).toStrictEqual([PERSONAL, WORK]);

    act(() => {
      fake.moveBrowser("1", "work");
    });
    expect(result.current?.profile).toStrictEqual(WORK);
  });

  it("is nothing until the engine lists the profiles", () => {
    const fake = new FakeDomicileHost();
    fake.domicile.browser.open("https://example.com");
    const { result } = renderHook(() => useBrowserProfile(fake.domicile, "1"));

    expect(result.current).toBeUndefined();
  });
});

describe("useProfileMark", () => {
  it("marks a page outside the default profile in its profile's color", () => {
    const fake = new FakeDomicileHost();
    fake.set({ browserProfiles: [PERSONAL, WORK] });
    fake.domicile.browser.open("https://example.com");
    const { result } = renderHook(() => useProfileMark(fake.domicile, "1"));
    expect(result.current).toBeUndefined();

    act(() => {
      fake.moveBrowser("1", "work");
    });
    expect(result.current).toBe("#d97706");
  });

  it("marks no window that is not the engine's", () => {
    const fake = new FakeDomicileHost();
    fake.set({ browserProfiles: [PERSONAL, WORK] });
    const { result } = renderHook(() =>
      useProfileMark(fake.domicile, undefined),
    );

    expect(result.current).toBeUndefined();
  });
});
