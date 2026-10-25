import { afterEach, describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { renderHook } from "@testing-library/react";
import { z } from "zod";

import type { NightLightOptions } from "./night-light-options";
import { useNightLight } from "./useNightLight";

const OFF: NightLightOptions = {
  from: "22:00",
  schedule: "off",
  to: "07:00",
  warmth: 50,
};

/** The color temperatures `fake` was asked for. */
const temperatures = (fake: FakeDomicileHost): number[] =>
  fake.calls
    .filter(([method]) => method === "callSystem")
    .map(([, , request]) =>
      requestSchema.parse(JSON.parse(z.string().parse(request))),
    )
    .flatMap(({ call, kelvin }) =>
      call === "set_color_temperature" ? [z.number().parse(kelvin)] : [],
    );

const requestSchema = z.looseObject({ call: z.string(), kelvin: z.unknown() });

describe("useNightLight", () => {
  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it("sets the screen's color temperature", () => {
    const fake = new FakeDomicileHost();

    renderHook(() => useNightLight(fake.domicile, OFF, "UTC"));

    expect(temperatures(fake)).toEqual([6500]);
  });

  it("tints again when the options change", () => {
    const fake = new FakeDomicileHost();
    globalThis.localStorage.setItem("night-light:v1", '{"on":true}');
    const { rerender } = renderHook(
      ({ warmth }) => useNightLight(fake.domicile, { ...OFF, warmth }, "UTC"),
      { initialProps: { warmth: 50 } },
    );

    rerender({ warmth: 100 });

    expect(temperatures(fake)).toEqual([3000, 2000]);
  });
});
