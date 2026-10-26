import { describe, expect, it } from "bun:test";
import type { Meter } from "./audio";
import { Meter as Meters } from "./audio";
import { sharedMeters } from "./shared-meters";
import type { Levels } from "./sound-server";

/** A sound server's meters the test drives: `levels` sends, and it records what it metered. */
const heldSound = () => {
  const listeners: ((levels: Levels) => void)[] = [];
  /** Each set of ids metered, in order; empty once stopped. */
  const metered: (readonly string[])[] = [];
  const counts = { started: 0, stopped: 0 };
  return {
    levels: (levels: Levels) => {
      for (const onLevels of listeners) {
        onLevels(levels);
      }
    },
    metered,
    server: {
      meters: (onLevels: (levels: Levels) => void) => {
        counts.started += 1;
        listeners.push(onLevels);
        return {
          meter: (wanted: ReadonlyMap<string, Meter>) => {
            metered.push([...wanted.keys()]);
          },
          stop: () => {
            counts.stopped += 1;
            metered.push([]);
          },
        };
      },
    },
    get started() {
      return counts.started;
    },
    get stopped() {
      return counts.stopped;
    },
  };
};

/** `ids`, each metered from a source of its own. */
const wanted = (...ids: string[]) =>
  new Map(ids.map((id) => [id, Meters.Source(id)] as const));

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
