import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

/** What `fake`'s appearance reads now. */
const read = (fake: FakeDomicileHost) => {
  const { accentColor, highContrast, reducedMotion } = desktop(
    fake.host,
  ).appearance;
  return { accentColor, highContrast, reducedMotion };
};

describe("appearance", () => {
  it("reads what the desktop said", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      accentColor: "#3584e4",
      highContrast: true,
      reducedMotion: true,
    });

    expect(read(fake)).toEqual({
      accentColor: "#3584e4",
      highContrast: true,
      reducedMotion: true,
    });
  });

  it("reads the defaults until the desktop says", () => {
    expect(read(new FakeDomicileHost())).toEqual({
      accentColor: undefined,
      highContrast: false,
      reducedMotion: false,
    });
  });

  it("says each change until stopped", () => {
    const fake = new FakeDomicileHost();
    let changes = 0;
    const stop = desktop(fake.host).appearance.on("change", () => {
      changes += 1;
    });
    fake.set({ highContrast: false, reducedMotion: true });
    stop();
    fake.set({ highContrast: true, reducedMotion: true });

    expect(changes).toBe(1);
  });

  it("refuses an accent that is not #rrggbb", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      accentColor: "blue",
      highContrast: false,
      reducedMotion: false,
    });

    expect(() => read(fake)).toThrow();
  });
});
