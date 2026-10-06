import { describe, expect, it } from "bun:test";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { fakeSysfs, panel, THINKPAD } from "./fake-system";
import { levelOf, readBacklight } from "./read-backlight";

describe("readBacklight", () => {
  it("reads the firmware backlight of a laptop that has two", async () => {
    expect(await readBacklight(fakeSysfs(THINKPAD).host)).toStrictEqual(
      Ok(Some({ device: "acpi_video0", max: 15, raw: 9 })),
    );
  });

  // systemd's order: a firmware interface knows the panel's curve, and a raw
  // one beside it drives the same panel.
  it("prefers firmware, then platform, then raw, then the first name", async () => {
    const device = async (devices: Parameters<typeof fakeSysfs>[0]) =>
      (await readBacklight(fakeSysfs(devices).host)).map((read) =>
        read.map(({ device }) => device),
      );

    expect(
      await device({
        a_raw: panel("raw", "1"),
        b_platform: panel("platform", "2"),
        c_firmware: panel("firmware", "3"),
      }),
    ).toStrictEqual(Ok(Some("c_firmware")));
    expect(
      await device({
        a_raw: panel("raw", "1"),
        b_platform: panel("platform", "2"),
      }),
    ).toStrictEqual(Ok(Some("b_platform")));
    expect(
      await device({ a_raw: panel("raw", "2"), b_raw: panel("raw", "1") }),
    ).toStrictEqual(Ok(Some("a_raw")));
  });

  it("finds nothing on a machine without a backlight", async () => {
    expect(await readBacklight(fakeSysfs(undefined).host)).toStrictEqual(
      Ok(None()),
    );
    expect(await readBacklight(fakeSysfs({}).host)).toStrictEqual(Ok(None()));
  });

  // A broken device gives no reading, not zero.
  it("skips a device it cannot read a level from", async () => {
    expect(
      await readBacklight(
        fakeSysfs({
          a_zero: { ...panel("firmware", "1"), max_brightness: "0\n" },
          b_no_max: { brightness: "1\n", type: "firmware\n" },
          c_garbled: panel("firmware", "bright"),
          d_unknown_type: panel("led", "1"),
          e_no_type: { brightness: "1\n", max_brightness: "1000\n" },
          f_good: panel("raw", "420"),
        }).host,
      ),
    ).toStrictEqual(Ok(Some({ device: "f_good", max: 1000, raw: 420 })));
  });

  it("never reads past the maximum", async () => {
    expect(
      await readBacklight(fakeSysfs({ panel: panel("raw", "1200") }).host),
    ).toStrictEqual(Ok(Some({ device: "panel", max: 1000, raw: 1000 })));
  });

  it("fails when /sys refuses it", async () => {
    const refused = {
      kind: SystemErrorKind.Locked,
      message: "the desktop is locked",
    };
    const { host } = fakeSysfs(THINKPAD);

    expect(
      await readBacklight({ ...host, readDir: async () => Err(refused) }),
    ).toStrictEqual(Err(refused));
    expect(
      await readBacklight({ ...host, readTextFile: async () => Err(refused) }),
    ).toStrictEqual(Err(refused));
  });
});

describe("levelOf", () => {
  it("is the fraction of the maximum", () => {
    expect(levelOf({ device: "panel", max: 1000, raw: 420 })).toBe(0.42);
  });
});
