import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("theme", () => {
  it("reads no theme until the compositor says", () => {
    const { theme } = desktop(new FakeDomicileHost().host);

    expect(theme.current).toBeUndefined();
    expect(theme.windows).toBeUndefined();
  });

  it("reads the desk's theme and the windows' theme", () => {
    const fake = new FakeDomicileHost();
    fake.set({ theme: "dark", windowsTheme: "light" });
    const { theme } = desktop(fake.host);

    expect(theme.current).toBe("dark");
    expect(theme.windows).toBe("light");
  });

  it("sets the theme and says the old frame is held", () => {
    const fake = new FakeDomicileHost();
    const { theme } = desktop(fake.host);
    theme.set("light");
    theme.captured("light");

    expect(fake.calls).toStrictEqual([
      ["setTheme", "light"],
      ["themeCaptured", "light"],
    ]);
  });

  it("says the theme changed, and the windows' theme apart from it", () => {
    const fake = new FakeDomicileHost();
    const { theme } = desktop(fake.host);
    const heard: string[] = [];
    theme.on("change", () => {
      heard.push("change");
    });
    theme.on("windowschange", () => {
      heard.push("windowschange");
    });
    fake.set({ theme: "dark" });
    fake.set({ windowsTheme: "dark" });

    expect(heard).toStrictEqual(["change", "windowschange"]);
  });
});

describe("appearance", () => {
  it("reads the defaults until the compositor says", () => {
    const { appearance } = desktop(new FakeDomicileHost().host);

    expect(appearance.accentColor).toBeUndefined();
    expect(appearance.highContrast).toBe(false);
    expect(appearance.reducedMotion).toBe(false);
  });

  it("reads what the config says", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      accentColor: "#3584e4",
      highContrast: true,
      reducedMotion: true,
    });
    const { appearance } = desktop(fake.host);

    expect(appearance.accentColor).toBe("#3584e4");
    expect(appearance.highContrast).toBe(true);
    expect(appearance.reducedMotion).toBe(true);
  });

  it("throws on an accent that is not #rrggbb", () => {
    const fake = new FakeDomicileHost();
    fake.set({ accentColor: "blue" });

    expect(() => desktop(fake.host).appearance.accentColor).toThrow();
  });

  it("says the appearance changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).appearance.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ reducedMotion: true });

    expect(await changed).toBeUndefined();
  });
});
