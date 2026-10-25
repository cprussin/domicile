import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { renderHook } from "@testing-library/react";

import { useAutoBrightness } from "./useAutoBrightness";

/** A sensor that counts its watches and their stops. */
const sensor = () => {
  const counts = { started: 0, stopped: 0 };
  return {
    counts,
    light: () => {
      counts.started += 1;
      return () => {
        counts.stopped += 1;
      };
    },
  };
};

describe("useAutoBrightness", () => {
  it("watches the room's light while enabled", () => {
    const { counts, light } = sensor();
    const domicile = new FakeDomicileHost().host;

    const { rerender, unmount } = renderHook(() =>
      useAutoBrightness(domicile, true, light),
    );
    rerender();
    unmount();

    expect(counts).toEqual({ started: 1, stopped: 1 });
  });

  it("leaves the sensor alone while disabled", () => {
    const { counts, light } = sensor();
    const domicile = new FakeDomicileHost().host;

    renderHook(() => useAutoBrightness(domicile, false, light));

    expect(counts).toEqual({ started: 0, stopped: 0 });
  });

  it("stops when it is disabled", () => {
    const { counts, light } = sensor();
    const domicile = new FakeDomicileHost().host;
    const { rerender } = renderHook(
      ({ enabled }) => useAutoBrightness(domicile, enabled, light),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });

    expect(counts).toEqual({ started: 1, stopped: 1 });
  });
});
