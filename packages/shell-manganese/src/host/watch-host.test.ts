import { describe, expect, it } from "bun:test";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { watchHost } from "./watch-host";

const brightnessOf = ({ brightness }: DomicileHost): number | undefined =>
  brightness ?? undefined;

/** Every level `fake` tells a watcher, and what stops it. */
const watching = (fake: FakeDomicileHost) => {
  const levels: number[] = [];
  const stop = watchHost(
    fake.host,
    "brightnesschanged",
    brightnessOf,
    (level) => {
      levels.push(level);
    },
  );
  return { levels, stop };
};

describe("watchHost", () => {
  it("tells what the host already said, then every change", () => {
    const fake = new FakeDomicileHost();
    fake.set({ brightness: 0.5 });

    const { levels } = watching(fake);
    fake.set({ brightness: 0.4 });

    expect(levels).toEqual([0.5, 0.4]);
  });

  it("tells nothing until the host has said something", () => {
    const fake = new FakeDomicileHost();

    const { levels } = watching(fake);

    expect(levels).toEqual([]);
  });

  it("tells every watcher, not only the last one to start", () => {
    const fake = new FakeDomicileHost();

    const first = watching(fake);
    const second = watching(fake);
    fake.set({ brightness: 0.5 });

    expect(first.levels).toEqual([0.5]);
    expect(second.levels).toEqual([0.5]);
  });

  it("stops telling when it is stopped", () => {
    const fake = new FakeDomicileHost();
    const { levels, stop } = watching(fake);

    stop();
    fake.set({ brightness: 0.5 });

    expect(levels).toEqual([]);
  });
});
