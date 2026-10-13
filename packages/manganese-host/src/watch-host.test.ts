import { describe, expect, it } from "bun:test";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { watchHost } from "./watch-host";

const lockedOf = ({ locked }: DomicileHost): boolean | undefined =>
  locked ?? undefined;

/** Every state `fake` tells a watcher, and what stops it. */
const watching = (fake: FakeDomicileHost) => {
  const states: boolean[] = [];
  const stop = watchHost(fake.host, "lockedchanged", lockedOf, (locked) => {
    states.push(locked);
  });
  return { states, stop };
};

describe("watchHost", () => {
  it("tells what the host already said, then every change", () => {
    const fake = new FakeDomicileHost();
    fake.set({ locked: true });

    const { states } = watching(fake);
    fake.set({ locked: false });

    expect(states).toEqual([true, false]);
  });

  it("tells nothing until the host has said something", () => {
    const fake = new FakeDomicileHost();

    const { states } = watching(fake);

    expect(states).toEqual([]);
  });

  it("tells every watcher, not only the last one to start", () => {
    const fake = new FakeDomicileHost();

    const first = watching(fake);
    const second = watching(fake);
    fake.set({ locked: true });

    expect(first.states).toEqual([true]);
    expect(second.states).toEqual([true]);
  });

  it("stops telling when it is stopped", () => {
    const fake = new FakeDomicileHost();
    const { states, stop } = watching(fake);

    stop();
    fake.set({ locked: true });

    expect(states).toEqual([]);
  });
});
