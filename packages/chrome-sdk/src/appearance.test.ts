import { describe, expect, it } from "bun:test";
import type { Appearance } from "./appearance";
import { watchAppearance } from "./appearance";
import { FakeDomicileHost } from "./fake-host";

const heard = (fake: FakeDomicileHost): Promise<Appearance> =>
  new Promise((resolve) => {
    watchAppearance(fake.host, resolve);
  });

describe("watchAppearance", () => {
  it("reads what the desktop already said", async () => {
    const fake = new FakeDomicileHost();
    fake.set({
      accentColor: "#3584e4",
      highContrast: true,
      reducedMotion: true,
    });

    expect(await heard(fake)).toEqual({
      accentColor: "#3584e4",
      highContrast: true,
      reducedMotion: true,
    });
  });

  it("reads the defaults until the desktop says", async () => {
    expect(await heard(new FakeDomicileHost())).toEqual({
      accentColor: undefined,
      highContrast: false,
      reducedMotion: false,
    });
  });

  it("follows each change until stopped", () => {
    const fake = new FakeDomicileHost();
    const seen: Appearance[] = [];
    const stop = watchAppearance(fake.host, (appearance) => {
      seen.push(appearance);
    });
    fake.set({ highContrast: false, reducedMotion: true });
    stop();
    fake.set({ highContrast: true, reducedMotion: true });

    expect(seen.map(({ reducedMotion }) => reducedMotion)).toEqual([
      false,
      true,
    ]);
  });

  it("refuses an accent that is not #rrggbb", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      accentColor: "blue",
      highContrast: false,
      reducedMotion: false,
    });

    expect(() => watchAppearance(fake.host, () => undefined)).toThrow();
  });
});
