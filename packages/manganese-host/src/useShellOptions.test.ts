import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { defineOptions, option } from "@domicile-desktop/sdk/options";
import { act, renderHook } from "@testing-library/react";

import { useShellOptions } from "./useShellOptions";

const OPTIONS = defineOptions({
  clock: { format: option.choice("Clock format", ["24h", "12h"], "24h") },
});

describe("useShellOptions", () => {
  it("is the defaults while the config sets none", () => {
    const fake = new FakeDomicileHost();

    const { result } = renderHook(() => useShellOptions(fake.host, OPTIONS));

    expect(result.current).toEqual({ clock: { format: "24h" } });
  });

  it("follows the config's values as they change", () => {
    const fake = new FakeDomicileHost();
    fake.set({ shellOptions: '{"clock":{"format":"12h"}}' });

    const { result } = renderHook(() => useShellOptions(fake.host, OPTIONS));
    expect(result.current).toEqual({ clock: { format: "12h" } });

    act(() => {
      fake.set({ shellOptions: "{}" });
    });
    expect(result.current).toEqual({ clock: { format: "24h" } });
  });
});
