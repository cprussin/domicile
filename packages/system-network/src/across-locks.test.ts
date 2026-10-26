import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { watchAcrossLocks } from "./across-locks";

/** A watch that counts its starts and stops, and reports which run sent a value. */
const counted = () => {
  const runs = { started: 0, stopped: 0 };
  const start = (onValue: (value: number) => void) => {
    runs.started += 1;
    onValue(runs.started);
    return () => {
      runs.stopped += 1;
    };
  };
  return { runs, start };
};

describe(watchAcrossLocks, () => {
  it("watches again once the desktop unlocks", () => {
    const fake = new FakeDomicileHost();
    fake.set({ locked: false });
    const { runs, start } = counted();
    const heard: number[] = [];

    const stop = watchAcrossLocks(
      fake.domicile,
      start,
    )((value) => {
      heard.push(value);
    });
    fake.set({ locked: true });
    fake.set({ locked: true });
    expect(runs).toEqual({ started: 1, stopped: 0 });

    fake.set({ locked: false });
    expect(runs).toEqual({ started: 2, stopped: 1 });
    expect(heard).toEqual([1, 2]);

    stop();
    fake.set({ locked: true });
    fake.set({ locked: false });
    expect(runs).toEqual({ started: 2, stopped: 2 });
  });

  it("watches again when the page starts locked and then unlocks", () => {
    const fake = new FakeDomicileHost();
    fake.set({ locked: true });
    const { runs, start } = counted();

    watchAcrossLocks(fake.domicile, start)(() => undefined);
    fake.set({ locked: false });

    expect(runs).toEqual({ started: 2, stopped: 1 });
  });
});
