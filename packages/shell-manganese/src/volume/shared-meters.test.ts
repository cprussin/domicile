import { describe, expect, it } from "bun:test";
import type { Levels } from "@domicile-desktop/system-audio/sound-server";

import { heldSound, laptop } from "./fixture";
import { sharedMeters } from "./shared-meters";

/** `ids` with their sources from the laptop. */
const wanted = (...ids: string[]) =>
  new Map(ids.map((id) => [id, laptop.meters.get(id) ?? noMeter(id)] as const));

const noMeter = (id: string) => {
  throw new Error(`the laptop has no meter for ${id}`);
};

describe("sharedMeters", () => {
  it("meters each id once for every mixer that shows it", () => {
    const sound = heldSound();
    const meters = sharedMeters(sound.server.meters);

    meters(() => undefined).meter(wanted("input:mic"));
    meters(() => undefined).meter(wanted("input:mic", "output:hdmi"));

    expect(sound.metered.at(-1)).toEqual(["input:mic", "output:hdmi"]);
    expect(sound.started).toBe(1);
  });

  it("tells each mixer only the levels it meters", () => {
    const sound = heldSound();
    const meters = sharedMeters(sound.server.meters);
    const heard: { a: Levels[]; b: Levels[] } = { a: [], b: [] };
    meters((levels) => heard.a.push(levels)).meter(wanted("input:mic"));
    meters((levels) => heard.b.push(levels)).meter(wanted("output:hdmi"));

    sound.levels(new Map([["input:mic", 0.5]]));

    expect(heard).toEqual({ a: [new Map([["input:mic", 0.5]])], b: [] });
  });

  it("keeps the ids another mixer meters when one stops, and stops after the last", () => {
    const sound = heldSound();
    const meters = sharedMeters(sound.server.meters);
    const a = meters(() => undefined);
    a.meter(wanted("input:mic"));
    const b = meters(() => undefined);
    b.meter(wanted("output:hdmi"));

    a.stop();
    expect(sound.metered.at(-1)).toEqual(["output:hdmi"]);

    b.stop();
    expect(sound.stopped).toBe(1);
  });

  it("starts again for a mixer opened after the last stopped", () => {
    const sound = heldSound();
    const meters = sharedMeters(sound.server.meters);
    meters(() => undefined).stop();

    meters(() => undefined).meter(wanted("input:mic"));

    expect(sound.started).toBe(2);
    expect(sound.metered.at(-1)).toEqual(["input:mic"]);
  });
});
