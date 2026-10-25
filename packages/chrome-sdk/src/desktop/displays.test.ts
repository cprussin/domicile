import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const display = {
  height: 1080,
  modeHeight: 1080,
  modeWidth: 1920,
  name: "left",
  scale: 1,
  transform: "rotate-90" as const,
  width: 1920,
  x: 0,
  y: 0,
};

describe("displays", () => {
  it("lists nothing until the compositor describes the desktop", () => {
    expect(desktop(new FakeDomicileHost().host).displays.list).toBeUndefined();
  });

  it("lists each screen, with an unknown rotation read as none", () => {
    const fake = new FakeDomicileHost();
    fake.set({ displays: [display, { ...display, transform: "flipped" }] });

    expect(desktop(fake.host).displays.list).toStrictEqual([
      display,
      { ...display, transform: "normal" },
    ]);
  });

  it("says the screens changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).displays.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ displays: [] });

    expect(await changed).toBeUndefined();
  });
});

describe("addVirtual", () => {
  it("asks the compositor for a monitor with no connector", async () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host)
      .displays.addVirtual({
        height: 1080,
        name: "Living room TV",
        refreshMhz: 60_000,
        width: 1920,
      })
      .catch(() => {
        /* never answered */
      });
    await Promise.resolve();

    expect(
      fake.calls.map(([method, , request]) => [
        method,
        JSON.parse(String(request)),
      ]),
    ).toStrictEqual([
      [
        "callSystem",
        {
          call: "virtual_monitor",
          height: 1080,
          name: "Living room TV",
          refresh_mhz: 60_000,
          width: 1920,
        },
      ],
    ]);
  });
});
