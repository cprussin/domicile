import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Ran, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { ETHERNET, fakeSysfs, VIRTUAL, WIFI } from "./fake-sysfs";
import type { NetworkInterface } from "./interfaces";
import {
  InterfaceKind,
  readAddresses,
  readInterfaces,
  watchAddresses,
  watchInterfaces,
} from "./interfaces";

const LAPTOP = { ...VIRTUAL, enp0s31f6: ETHERNET, wlan0: WIFI };

const LOCKED: SystemError = {
  kind: SystemErrorKind.Locked,
  message: "the desktop is locked",
};

/** A clock the test ticks by hand. */
const heldClock = () => {
  const ticks: (() => void)[] = [];
  return {
    every: (_ms: number, tick: () => void) => {
      ticks.push(tick);
      return () => {
        ticks.splice(ticks.indexOf(tick), 1);
      };
    },
    get running() {
      return ticks.length;
    },
    tick: () => {
      for (const tick of ticks) {
        tick();
      }
    },
  };
};

/** Each report, in order, as a promise for the next. */
const reports = () => {
  const queue: Result<NetworkInterface[], SystemError>[] = [];
  const waiting: ((value: Result<NetworkInterface[], SystemError>) => void)[] =
    [];
  return {
    next: () =>
      new Promise<Result<NetworkInterface[], SystemError>>((resolve) => {
        const ready = queue.shift();
        if (ready === undefined) {
          waiting.push(resolve);
        } else {
          resolve(ready);
        }
      }),
    onInterfaces: (value: Result<NetworkInterface[], SystemError>) => {
      const resolve = waiting.shift();
      if (resolve === undefined) {
        queue.push(value);
      } else {
        resolve(value);
      }
    },
    get pending() {
      return queue.length;
    },
  };
};

/** The value of `result`, which the test expects to be `Ok`. */
const okOf = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.unwrapOrElse((error) => {
    throw new Error(`test: expected Ok, got ${error.message}`);
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe(readInterfaces, () => {
  it("lists the hardware, wired and wireless, by name", async () => {
    const { domicile: system } = fakeSysfs(LAPTOP);

    expect(await readInterfaces(system)).toEqual(
      Ok([
        {
          hardwareAddress: "8c:16:45:5a:3e:01",
          kind: InterfaceKind.Wired,
          name: "enp0s31f6",
          speed: 1000,
          up: true,
        },
        {
          hardwareAddress: "a4:c3:f0:85:ac:2d",
          kind: InterfaceKind.Wireless,
          name: "wlan0",
          speed: undefined,
          up: true,
        },
      ]),
    );
  });

  it("reads no speed from a port with no cable", async () => {
    const { speed: _, ...unplugged } = { ...ETHERNET, operstate: "down\n" };
    const { domicile: system } = fakeSysfs({ enp0s31f6: unplugged });

    expect(await readInterfaces(system)).toEqual(
      Ok([
        {
          hardwareAddress: "8c:16:45:5a:3e:01",
          kind: InterfaceKind.Wired,
          name: "enp0s31f6",
          speed: undefined,
          up: false,
        },
      ]),
    );
  });

  it("finds none on a machine with only virtual interfaces", async () => {
    const { domicile: system } = fakeSysfs(VIRTUAL);

    expect(await readInterfaces(system)).toEqual(Ok([]));
  });

  it("fails when the kernel cannot be read", async () => {
    const { domicile: system } = fakeSysfs(LAPTOP);

    const failed = await readInterfaces({
      files: { ...system.files, readDir: () => Promise.resolve(Err(LOCKED)) },
    });

    expect(failed).toEqual(Err(LOCKED));
  });
});

describe(watchInterfaces, () => {
  it("reports now, and again only once the interfaces change", async () => {
    const sysfs = fakeSysfs(LAPTOP);
    const clock = heldClock();
    const heard = reports();
    const stop = watchInterfaces(
      sysfs.domicile,
      heard.onInterfaces,
      clock.every,
    );

    expect(okOf(await heard.next())).toHaveLength(2);

    clock.tick();
    await settle();
    expect(heard.pending).toBe(0);

    sysfs.set({ ...LAPTOP, enp0s31f6: { ...ETHERNET, operstate: "down\n" } });
    clock.tick();
    expect(
      okOf(await heard.next()).find(({ name }) => name === "enp0s31f6")?.up,
    ).toBe(false);

    stop();
    expect(clock.running).toBe(0);
  });

  it("reports nothing after it stops", async () => {
    const sysfs = fakeSysfs(LAPTOP);
    const clock = heldClock();
    const heard = reports();
    const stop = watchInterfaces(
      sysfs.domicile,
      heard.onInterfaces,
      clock.every,
    );
    stop();

    await settle();

    expect(heard.pending).toBe(0);
  });
});

/** `ip -j address show` on the laptop, trimmed. */
const ADDRESSES = JSON.stringify([
  {
    addr_info: [
      { family: "inet", local: "127.0.0.1", prefixlen: 8, scope: "host" },
    ],
    ifname: "lo",
  },
  {
    addr_info: [
      { family: "inet", local: "192.168.1.40", prefixlen: 24, scope: "global" },
      {
        family: "inet6",
        local: "fd00::1c2b:3aff:fe4d:5e6f",
        prefixlen: 64,
        scope: "global",
      },
      {
        deprecated: true,
        family: "inet6",
        local: "fd00::9a41:77c2:d0e3:15b8",
        prefixlen: 64,
        scope: "global",
        temporary: true,
      },
      {
        family: "inet6",
        local: "fe80::8e16:45ff:fe5a:3e01",
        prefixlen: 64,
        scope: "link",
      },
    ],
    ifname: "enp0s31f6",
  },
  { addr_info: [], ifname: "wlan0" },
]);

/** `ip -j route show default`. */
const ROUTES = JSON.stringify([
  { dev: "enp0s31f6", dst: "default", gateway: "192.168.1.1" },
]);

const ran = (stdout: string): Result<Ran, SystemError> =>
  Ok({ code: 0, signal: undefined, stderr: "", stdout });

describe(readAddresses, () => {
  it("reads each interface's current global addresses and its gateway from ip", async () => {
    const asked: (readonly string[])[] = [];
    const addresses = await readAddresses({
      processes: {
        run: (argv) => {
          asked.push(argv);
          return Promise.resolve(
            ran(argv.includes("route") ? ROUTES : ADDRESSES),
          );
        },
      },
    });

    expect(asked).toEqual([
      ["ip", "-j", "address", "show"],
      ["ip", "-j", "route", "show", "default"],
    ]);
    expect(okOf(addresses).get("enp0s31f6")).toEqual({
      addresses: ["192.168.1.40/24", "fd00::1c2b:3aff:fe4d:5e6f/64"],
      gateway: "192.168.1.1",
    });
    expect(okOf(addresses).get("wlan0")).toEqual({
      addresses: [],
      gateway: undefined,
    });
  });

  it("fails when ip does", async () => {
    const addresses = await readAddresses({
      processes: {
        run: () =>
          Promise.resolve(
            Ok({ code: 1, signal: undefined, stderr: "nope", stdout: "" }),
          ),
      },
    });

    expect(addresses.isErr()).toBe(true);
  });
});

describe(watchAddresses, () => {
  it("reports the addresses again once they change", async () => {
    const clock = heldClock();
    const listed = { now: ADDRESSES };
    const heard: Result<Map<string, unknown>, SystemError>[] = [];
    watchAddresses(
      {
        processes: {
          run: (argv) =>
            Promise.resolve(ran(argv.includes("route") ? ROUTES : listed.now)),
        },
      },
      (addresses) => {
        heard.push(addresses);
      },
      clock.every,
    );
    await settle();
    clock.tick();
    await settle();
    expect(heard).toHaveLength(1);

    listed.now = JSON.stringify([{ addr_info: [], ifname: "enp0s31f6" }]);
    clock.tick();
    await settle();

    expect(heard).toHaveLength(2);
  });
});
