import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("clipboard", () => {
  it("lists nothing until the compositor says", () => {
    expect(
      desktop(new FakeDomicileHost().host).clipboard.entries,
    ).toBeUndefined();
  });

  it("lists the history and puts a row back", () => {
    const fake = new FakeDomicileHost();
    fake.set({ clipboard: [{ id: 3, preview: "hello" }] });
    const { clipboard } = desktop(fake.host);
    clipboard.copy(3);

    expect(clipboard.entries).toStrictEqual([{ id: 3, preview: "hello" }]);
    expect(fake.calls).toStrictEqual([["copyClipboardEntry", 3]]);
  });

  it("says the history changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).clipboard.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ clipboard: [] });

    expect(await changed).toBeUndefined();
  });
});
