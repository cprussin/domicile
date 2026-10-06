// A `/sys/class/backlight` for tests, answered through the system calls the
// library makes, from files recorded on real machines.

import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { SysfsHost } from "./read-backlight";

/** Each device's files and their contents, as `cat` prints them. */
export type Devices = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/** A ThinkPad X1 Carbon's, recorded: Intel's raw panel and ACPI's firmware one. */
export const THINKPAD: Devices = {
  acpi_video0: {
    brightness: "9\n",
    max_brightness: "15\n",
    type: "firmware\n",
  },
  intel_backlight: {
    brightness: "40336\n",
    max_brightness: "96000\n",
    type: "raw\n",
  },
};

/** A panel with a raw `brightness` out of 1000. */
export const panel = (type: string, brightness: string) => ({
  brightness: `${brightness}\n`,
  max_brightness: "1000\n",
  type: `${type}\n`,
});

/**
 * `devices` as `/sys/class/backlight`, which is missing when `devices` is
 * `undefined`. `set` replaces the devices a later read sees.
 */
export const fakeSysfs = (devices: Devices | undefined) => {
  let now = devices;
  const host: SysfsHost = {
    readDir: async (path) =>
      now === undefined || path !== "/sys/class/backlight"
        ? Err(notFound(path))
        : Ok(
            // The kernel lists them unsorted.
            Object.keys(now)
              .toReversed()
              .map((name) => ({ fileType: FileType.Symlink, name })),
          ),
    readTextFile: (path) => {
      const [device, file] = path
        .replace(/^\/sys\/class\/backlight\//, "")
        .split("/");
      const contents =
        device === undefined || file === undefined
          ? undefined
          : now?.[device]?.[file];
      return Promise.resolve(
        contents === undefined ? Err(notFound(path)) : Ok(contents),
      );
    },
  };
  return {
    host,
    set: (next: Devices | undefined) => {
      now = next;
    },
  };
};

export const notFound = (path: string): SystemError => ({
  kind: SystemErrorKind.NotFound,
  message: `${path}: No such file or directory`,
});
