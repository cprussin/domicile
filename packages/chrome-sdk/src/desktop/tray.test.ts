import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const item = {
  bus: ":1.42",
  icon: "data:image/png;base64,AA==",
  id: "nm-applet",
  itemIsMenu: false,
  menu: "/MenuBar",
  title: "Network",
};

describe("tray", () => {
  it("lists nothing until the compositor says", () => {
    expect(desktop(new FakeDomicileHost().host).tray.items).toBeUndefined();
  });

  it("lists each icon, with undefined for no icon or no menu", () => {
    const fake = new FakeDomicileHost();
    fake.set({ tray: [item, { ...item, icon: "", menu: "" }] });

    expect(desktop(fake.host).tray.items).toStrictEqual([
      item,
      { ...item, icon: undefined, menu: undefined },
    ]);
  });

  it("clicks an icon", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).tray.activate("nm-applet", "context");

    expect(fake.calls).toStrictEqual([
      ["activateTrayItem", "nm-applet", "context"],
    ]);
  });

  it("reads an icon's menu over D-Bus", async () => {
    const fake = new FakeDomicileHost();
    const menu = desktop(fake.host).tray.menu(
      { bus: ":1.42", path: "/MenuBar" },
      () => {
        /* never answered */
      },
    );
    await Promise.resolve();
    menu.stop();

    expect(fake.calls[0]?.[0]).toBe("callSystem");
  });

  it("says the icons changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).tray.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ tray: [] });

    expect(await changed).toBeUndefined();
  });
});
