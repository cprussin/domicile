import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { SysfsSystem } from "./hardware";
import { hasBattery } from "./hardware";

/** `files` as `/sys`, by absolute path: each listed directory holds what is under it. */
const sysfs = (files: Readonly<Record<string, string>>): SysfsSystem => ({
  readDir: (path: string) => {
    const names = [
      ...new Set(
        Object.keys(files)
          .filter((file) => file.startsWith(`${path}/`))
          .map((file) => file.slice(path.length + 1).split("/")[0] ?? ""),
      ),
    ];
    return Promise.resolve(
      names.length === 0
        ? Err(notFound(path))
        : Ok(names.map((name) => ({ fileType: FileType.Symlink, name }))),
    );
  },
  readTextFile: (path: string) => {
    const contents = files[path];
    return Promise.resolve(
      contents === undefined ? Err(notFound(path)) : Ok(contents),
    );
  },
});

const notFound = (path: string): SystemError => ({
  kind: SystemErrorKind.NotFound,
  message: `${path}: No such file or directory`,
});

const LOCKED: SystemError = {
  kind: SystemErrorKind.PermissionDenied,
  message: "/sys/class: Permission denied",
};

describe(hasBattery, () => {
  it("finds the machine's battery", async () => {
    expect(
      await hasBattery(
        sysfs({
          "/sys/class/power_supply/AC/type": "Mains\n",
          "/sys/class/power_supply/BAT0/scope": "System\n",
          "/sys/class/power_supply/BAT0/type": "Battery\n",
        }),
      ),
    ).toEqual(Ok(true));
  });

  it("finds one that reports no scope", async () => {
    expect(
      await hasBattery(
        sysfs({ "/sys/class/power_supply/BAT1/type": "Battery\n" }),
      ),
    ).toEqual(Ok(true));
  });

  it("leaves out a mouse's or headset's battery", async () => {
    expect(
      await hasBattery(
        sysfs({
          "/sys/class/power_supply/AC/type": "Mains\n",
          "/sys/class/power_supply/hidpp_battery_0/scope": "Device\n",
          "/sys/class/power_supply/hidpp_battery_0/type": "Battery\n",
        }),
      ),
    ).toEqual(Ok(false));
  });

  it("finds none without a power supply class", async () => {
    expect(await hasBattery(sysfs({}))).toEqual(Ok(false));
  });

  it("fails when /sys cannot be read", async () => {
    expect(
      await hasBattery({
        ...sysfs({}),
        readDir: () => Promise.resolve(Err(LOCKED)),
      }),
    ).toEqual(Err(LOCKED));
  });
});
