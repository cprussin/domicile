import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const display = {
  adaptiveSync: "unsupported" as const,
  height: 1080,
  modeHeight: 1080,
  modeWidth: 1920,
  name: "left",
  refreshMhz: 60_000,
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

  it("says whether each screen's adaptive sync is on, with an unknown state read as unsupported", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      displays: [
        { ...display, adaptiveSync: "on" },
        { ...display, adaptiveSync: "off" },
        { ...display, adaptiveSync: "variable" },
      ],
    });

    expect(
      desktop(fake.host).displays.list?.map(({ adaptiveSync }) => adaptiveSync),
    ).toStrictEqual(["on", "off", "unsupported"]);
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
          scale: 1,
          width: 1920,
        },
      ],
    ]);
  });
});

describe("setColorTemperature", () => {
  it("asks the compositor to warm every monitor", async () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host)
      .displays.setColorTemperature(3400)
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
      ["callSystem", { call: "set_color_temperature", kelvin: 3400 }],
    ]);
  });

  it("warms one monitor, by name", async () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host)
      .displays.setColorTemperature(3400, "eDP-2")
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
        { call: "set_color_temperature", display: "eDP-2", kelvin: 3400 },
      ],
    ]);
  });
});
