// A `/sys/class/net` for tests, answered through the file calls the library
// makes, laid out as on a laptop with a cable port, Wi-Fi and a VPN.

import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { InterfaceDesktop } from "./interfaces";

/** Each interface's files and their contents, as `cat` prints them; `null` is a directory or link. */
export type Interfaces = Readonly<
  Record<string, Readonly<Record<string, string | null>>>
>;

/** A wired port with a cable in at a gigabit. */
export const ETHERNET = {
  address: "8c:16:45:5a:3e:01\n",
  device: null,
  operstate: "up\n",
  speed: "1000\n",
};

/** A Wi-Fi card, on a network. */
export const WIFI = {
  address: "a4:c3:f0:85:ac:2d\n",
  device: null,
  operstate: "up\n",
  phy80211: null,
  speed: "-1\n",
  wireless: null,
};

/** The loopback and a WireGuard tunnel: no `device`, so no hardware. */
export const VIRTUAL = {
  lo: { address: "00:00:00:00:00:00\n", operstate: "unknown\n" },
  wg0: { operstate: "unknown\n" },
};

/**
 * `interfaces` as `/sys/class/net`. `set` replaces what a later read sees.
 * A port with no link fails a read of `speed`, as the kernel does.
 */
export const fakeSysfs = (interfaces: Interfaces) => {
  let now = interfaces;
  const fileOf = (path: string) => {
    const [name, file] = path.replace(/^\/sys\/class\/net\//, "").split("/");
    return name === undefined || file === undefined
      ? undefined
      : now[name]?.[file];
  };
  const domicile: InterfaceDesktop = {
    files: {
      readDir: (path) =>
        Promise.resolve(
          path === "/sys/class/net"
            ? Ok(
                // The kernel lists them unsorted.
                Object.keys(now)
                  .toReversed()
                  .map((name) => ({ fileType: FileType.Symlink, name })),
              )
            : Err(notFound(path)),
        ),
      readText: (path) => {
        const contents = fileOf(path);
        return Promise.resolve(
          typeof contents === "string"
            ? Ok(contents)
            : Err(
                contents === null
                  ? { kind: SystemErrorKind.IsADirectory, message: path }
                  : notFound(path),
              ),
        );
      },
      stat: (path) =>
        Promise.resolve(
          fileOf(path) === undefined
            ? Err(notFound(path))
            : Ok({ fileType: FileType.Directory, modifiedMs: 0, size: 0 }),
        ),
    },
  };
  return {
    domicile,
    set: (next: Interfaces) => {
      now = next;
    },
  };
};

export const notFound = (path: string): SystemError => ({
  kind: SystemErrorKind.NotFound,
  message: `${path}: No such file or directory`,
});
