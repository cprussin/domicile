import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const action = {
  badgeColor: "#00000000",
  badgeText: "",
  enabled: true,
  icon: "data:image/png;base64,AA==",
  id: "abcdefghijklmnopabcdefghijklmnop",
  name: "Dark Reader",
  popup: null,
  title: "Dark Reader",
};

describe("extensions", () => {
  it("lists nothing until the engine says", () => {
    expect(
      desktop(new FakeDomicileHost().host).extensions.list,
    ).toBeUndefined();
  });

  it("lists each action, with undefined for no popup", () => {
    const fake = new FakeDomicileHost();
    fake.set({ extensions: [action] });

    expect(desktop(fake.host).extensions.list).toStrictEqual([
      { ...action, popup: undefined },
    ]);
  });

  it("throws on an action it cannot draw", () => {
    const fake = new FakeDomicileHost();
    fake.set({ extensions: [{ ...action, id: "not-an-id" }] });

    expect(() => desktop(fake.host).extensions.list).toThrow();
  });

  it("clicks an action", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).extensions.activate(action.id);

    expect(fake.calls).toStrictEqual([["activateExtension", action.id]]);
  });

  it("says the actions changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).extensions.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ extensions: [] });

    expect(await changed).toBeUndefined();
  });
});
