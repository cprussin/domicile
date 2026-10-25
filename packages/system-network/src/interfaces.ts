// The machine's network hardware, read from `/sys/class/net`, and each
// interface's addresses, from `ip`. Every backend's machine has both, so the
// wired port shows the same with NetworkManager, iwd or wpa_supplicant.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { z } from "zod";

const NET = "/sys/class/net";

/** How often the watches read again: a cable's carrier sends no uevent. */
const EVERY_MS = 5000;

export enum InterfaceKind {
  Wired,
  Wireless,
}

/** A network interface with hardware behind it. */
export type NetworkInterface = {
  name: string;
  kind: InterfaceKind;
  hardwareAddress: string;
  /** Whether it has a link: a cable in, or a Wi-Fi network joined. */
  up: boolean;
  /** A wired link's speed in Mbit/s, when the driver knows it. */
  speed: number | undefined;
};

/** An interface's addresses, from `ip`. */
export type Addressing = {
  /** Global addresses in use with their prefix length, e.g. `192.168.1.40/24`. */
  addresses: string[];
  /** The default route's gateway through it. */
  gateway: string | undefined;
};

/** The calls {@link readInterfaces} makes. Each works while the desktop is locked. */
export type InterfaceDesktop = {
  readonly files: Pick<Files, "readDir" | "readText" | "stat">;
};

/**
 * The interfaces with hardware behind them, by name. Virtual ones, such as
 * the loopback, a bridge or a VPN, have no `device` link and are left out.
 */
export const readInterfaces = async (
  domicile: InterfaceDesktop,
): Promise<Result<NetworkInterface[], SystemError>> =>
  (await domicile.files.readDir(NET)).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async (entries) => {
      const read = await Promise.all(
        entries
          .map(({ name }) => name)
          .toSorted()
          .map((name) => interfaceOf(domicile, name)),
      );
      return read.reduce<Result<NetworkInterface[], SystemError>>(
        (all, each) =>
          all.andThen((found) =>
            each.map((one) =>
              one.match({ None: () => found, Some: (it) => [...found, it] }),
            ),
          ),
        Ok([]),
      );
    },
  });

/**
 * Calls `onInterfaces` with {@link readInterfaces} now and whenever it
 * changes, and returns a function that stops watching. Reads every 5 seconds.
 */
export const watchInterfaces = (
  domicile: InterfaceDesktop,
  onInterfaces: (interfaces: Result<NetworkInterface[], SystemError>) => void,
  every: typeof everyInterval = everyInterval,
): (() => void) => poll(() => readInterfaces(domicile), onInterfaces, every);

/**
 * Calls `onAddresses` with {@link readAddresses} now and whenever it changes,
 * and returns a function that stops watching. Reads every 5 seconds.
 */
export const watchAddresses = (
  domicile: { readonly processes: Pick<Processes, "run"> },
  onAddresses: (
    addresses: Result<Map<string, Addressing>, SystemError>,
  ) => void,
  every: typeof everyInterval = everyInterval,
): (() => void) => poll(() => readAddresses(domicile), onAddresses, every);

/**
 * Each interface's global addresses in use and default gateway, by name, from
 * `ip -j`. `ip` must be on the compositor's `PATH`.
 */
export const readAddresses = async (domicile: {
  readonly processes: Pick<Processes, "run">;
}): Promise<Result<Map<string, Addressing>, SystemError>> => {
  const addresses = await ip(domicile, ["address", "show"], addressesSchema);
  const routes = await ip(domicile, ["route", "show", "default"], routesSchema);
  return addresses.andThen((listed) =>
    routes.map(
      (defaults) =>
        new Map(
          listed.map(({ addr_info: info, ifname }) => [
            ifname,
            {
              addresses: info
                .filter(
                  ({ deprecated, scope }) =>
                    scope === "global" && deprecated !== true,
                )
                .map(({ local, prefixlen }) => `${local}/${prefixlen}`),
              gateway: defaults.find(({ dev }) => dev === ifname)?.gateway,
            },
          ]),
        ),
    ),
  );
};

/** Reports `read` now and every {@link EVERY_MS}, when it differs from the last report. */
const poll = <T extends NonNullable<unknown>>(
  read: () => Promise<Result<T, SystemError>>,
  onValue: (value: Result<T, SystemError>) => void,
  every: typeof everyInterval,
): (() => void) => {
  const watch: Watch = {
    reading: Promise.resolve(),
    shown: undefined,
    stopped: false,
  };
  const reread = () => {
    watch.reading = watch.reading
      .then(async () => {
        const value = await read();
        const shown = JSON.stringify(
          value.match<unknown>({
            Err: (error) => error,
            // A `Map` is `{}` to JSON.
            Ok: (found) => (found instanceof Map ? [...found] : found),
          }),
        );
        if (!watch.stopped && shown !== watch.shown) {
          watch.shown = shown;
          onValue(value);
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a background failure; the next tick reads again
        console.error("Failed to read the network interfaces", error);
      });
  };
  reread();
  const stopClock = every(EVERY_MS, reread);
  return () => {
    watch.stopped = true;
    stopClock();
  };
};

/** A watch's state, shared by its reads and its stop function. */
type Watch = {
  /** The reads in order, so a slow one cannot report after a newer one. */
  reading: Promise<void>;
  /** The last report, as JSON. */
  shown: string | undefined;
  stopped: boolean;
};

const everyInterval = (ms: number, tick: () => void): (() => void) => {
  const id = setInterval(tick, ms);
  return () => {
    clearInterval(id);
  };
};

/** The interface `name`, or `None` for a virtual one. */
const interfaceOf = async (
  domicile: InterfaceDesktop,
  name: string,
): Promise<Result<Option<NetworkInterface>, SystemError>> => {
  const at = `${NET}/${name}`;
  return (await exists(domicile, `${at}/device`)).match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async (physical) =>
      physical
        ? (await hardwareOf(domicile, name)).map(Some)
        : Ok<Option<NetworkInterface>, SystemError>(None()),
  });
};

/** The interface `name`, which has a `device`. */
const hardwareOf = async (
  domicile: InterfaceDesktop,
  name: string,
): Promise<Result<NetworkInterface, SystemError>> => {
  const at = `${NET}/${name}`;
  const wireless = await exists(domicile, `${at}/wireless`);
  const address = await line(domicile, `${at}/address`);
  const state = await line(domicile, `${at}/operstate`);
  const up = state.map((operstate) => operstate === "up");
  const speed =
    up.unwrapOr(false) && !wireless.unwrapOr(true)
      ? await speedOf(domicile, at)
      : undefined;
  return wireless.andThen((isWireless) =>
    address.andThen((hardwareAddress) =>
      up.map((linked) => ({
        hardwareAddress,
        kind: isWireless ? InterfaceKind.Wireless : InterfaceKind.Wired,
        name,
        speed,
        up: linked,
      })),
    ),
  );
};

/** Whether `path` exists. */
const exists = async (
  domicile: InterfaceDesktop,
  path: string,
): Promise<Result<boolean, SystemError>> =>
  (await domicile.files.stat(path)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(false) : Err(error),
    Ok: () => Ok(true),
  });

/** A one-line file under `/sys`, without its newline. */
const line = async (
  domicile: InterfaceDesktop,
  path: string,
): Promise<Result<string, SystemError>> =>
  (await domicile.files.readText(path)).map((text) => text.trim());

/**
 * A wired link's speed. The kernel fails the read, or answers `-1`, when the
 * driver does not know it, which is no speed to show.
 */
const speedOf = async (
  domicile: InterfaceDesktop,
  at: string,
): Promise<number | undefined> =>
  (await line(domicile, `${at}/speed`)).match({
    Err: () => undefined,
    Ok: (text) => {
      const mbits = Number.parseInt(text, 10);
      return mbits > 0 ? mbits : undefined;
    },
  });

/** `ip -j` with `argv`, parsed with `schema`. */
const ip = async <T extends NonNullable<unknown>>(
  domicile: { readonly processes: Pick<Processes, "run"> },
  argv: readonly string[],
  schema: z.ZodType<T>,
): Promise<Result<T, SystemError>> =>
  (await domicile.processes.run(["ip", "-j", ...argv])).andThen(
    ({ code, stderr, stdout }) =>
      code === 0
        ? Ok(schema.parse(JSON.parse(stdout)))
        : Err({
            kind: SystemErrorKind.Other,
            message: `ip ${argv.join(" ")} exited ${String(code)}: ${stderr.trim()}`,
          }),
  );

const addressesSchema = z.array(
  z.object({
    addr_info: z.array(
      z.object({
        // An IPv6 address past its preferred lifetime, kept only for open connections.
        deprecated: z.boolean().optional(),
        local: z.string(),
        prefixlen: z.number(),
        scope: z.string(),
      }),
    ),
    ifname: z.string(),
  }),
);

const routesSchema = z.array(
  z.object({ dev: z.string(), gateway: z.string().optional() }),
);
