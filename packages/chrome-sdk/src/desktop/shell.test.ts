import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("shell", () => {
  it("reads no options until the compositor says", () => {
    expect(desktop(new FakeDomicileHost().host).shell.options).toBeUndefined();
  });

  it("reads the config's options for the shell", () => {
    const fake = new FakeDomicileHost();
    fake.set({ shellOptions: JSON.stringify({ bar: { clock: true } }) });

    expect(desktop(fake.host).shell.options).toStrictEqual({
      bar: { clock: true },
    });
  });

  it("throws on options that are not an object", () => {
    const fake = new FakeDomicileHost();
    fake.set({ shellOptions: "[]" });

    expect(() => desktop(fake.host).shell.options).toThrow();
  });

  it("listens for commands through the compositor", async () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host)
      .shell.commands()
      .catch(() => {
        /* never answered */
      });
    await Promise.resolve();

    expect(fake.calls).toStrictEqual([
      ["callSystem", 1, JSON.stringify({ call: "shell_commands" })],
    ]);
  });

  it("says the options changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).shell.on("optionschange", () => {
        resolve(undefined);
      });
    });
    fake.set({ shellOptions: "{}" });

    expect(await changed).toBeUndefined();
  });
});
