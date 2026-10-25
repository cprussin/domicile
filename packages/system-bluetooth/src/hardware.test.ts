import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { SysfsDesktop } from "./hardware";
import { hasBluetoothHardware } from "./hardware";

/** `files` as `/sys`, by absolute path: each listed directory holds what is under it. */
const sysfs = (files: Readonly<Record<string, string>>): SysfsDesktop => ({
  files: {
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
    readText: (path: string) => {
      const contents = files[path];
      return Promise.resolve(
        contents === undefined ? Err(notFound(path)) : Ok(contents),
      );
    },
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

describe(hasBluetoothHardware, () => {
  it("finds a controller", async () => {
    expect(
      await hasBluetoothHardware(
        sysfs({ "/sys/class/bluetooth/hci0/address": "00:1a:7d:da:71:13\n" }),
      ),
    ).toEqual(Ok(true));
  });

  it("finds a radio rfkill has turned off, with no controller left", async () => {
    expect(
      await hasBluetoothHardware(
        sysfs({
          "/sys/class/rfkill/rfkill0/type": "wlan\n",
          "/sys/class/rfkill/rfkill1/type": "bluetooth\n",
        }),
      ),
    ).toEqual(Ok(true));
  });

  it("finds none on a machine without Bluetooth", async () => {
    expect(
      await hasBluetoothHardware(
        sysfs({ "/sys/class/rfkill/rfkill0/type": "wlan\n" }),
      ),
    ).toEqual(Ok(false));
  });

  it("fails when /sys cannot be read", async () => {
    expect(
      await hasBluetoothHardware({
        files: {
          ...sysfs({}).files,
          readDir: () => Promise.resolve(Err(LOCKED)),
        },
      }),
    ).toEqual(Err(LOCKED));
  });
});
