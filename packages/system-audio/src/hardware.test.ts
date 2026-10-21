import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { SysfsSystem } from "./hardware";
import { hasSoundCard } from "./hardware";

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

describe(hasSoundCard, () => {
  it("finds a sound card", async () => {
    expect(
      await hasSoundCard(
        sysfs({
          "/sys/class/sound/card0/id": "PCH\n",
          "/sys/class/sound/controlC0/dev": "116:2\n",
          "/sys/class/sound/timer/dev": "116:33\n",
        }),
      ),
    ).toEqual(Ok(true));
  });

  it("finds none with only ALSA's timer, or no sound class", async () => {
    expect(
      await hasSoundCard(sysfs({ "/sys/class/sound/timer/dev": "116:33\n" })),
    ).toEqual(Ok(false));
    expect(await hasSoundCard(sysfs({}))).toEqual(Ok(false));
  });

  it("fails when /sys cannot be read", async () => {
    expect(
      await hasSoundCard({
        ...sysfs({}),
        readDir: () => Promise.resolve(Err(LOCKED)),
      }),
    ).toEqual(Err(LOCKED));
  });
});
