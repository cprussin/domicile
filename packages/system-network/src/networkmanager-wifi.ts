// NetworkManager's Wi-Fi device over the system bus: its networks and
// connection, kept current, and the requests that change them. See
// docs/SHELL-SYSTEM-ACCESS.md.

import type { Option } from "@cprussin/option-result";
import { None, Ok, Result, Some } from "@cprussin/option-result";
import type {
  DbusCall,
  DbusSignal,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import type { Reading } from "./follow";
import { followBus } from "./follow";
import type { NetworkSystem } from "./network-state";
import { variant } from "./variant";
import type {
  Ip,
  Wifi,
  WifiConnection,
  WifiDevice,
  WifiNetwork,
} from "./wifi-state";
import { WifiBackend } from "./wifi-state";

const SERVICE = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";
const DEVICE = `${SERVICE}.Device`;
const WIRELESS = `${SERVICE}.Device.Wireless`;
/** The object path NetworkManager uses for "none". */
const NO_OBJECT = "/";
/** `NM_DEVICE_TYPE_WIFI`. */
const WIFI_DEVICE = 2;

/** A read's outcome: Wi-Fi, if there is a device, or the first failure. */
type Found = Result<Option<Wifi>, SystemError>;

/**
 * Calls `onWifi` with the first Wi-Fi device now and after each change, and
 * returns a function that stops watching. `None` is a machine without one.
 *
 * An `Err` is a D-Bus failure, such as NetworkManager not running. The watch
 * keeps listening after one, so a later change reads again.
 */
export const watchNetworkManagerWifi = (
  system: NetworkSystem,
  onWifi: (wifi: Found) => void,
): (() => void) =>
  followBus(
    system,
    { bus: Bus.System, sender: SERVICE },
    () => read(system),
    onWifi,
  );

/** Turn the Wi-Fi radio on or off. */
export const setNetworkManagerWifiEnabled = async (
  system: NetworkSystem,
  _wifi: WifiDevice,
  enabled: boolean,
): Promise<Result<"done", SystemError>> =>
  done(
    await system.dbusCall(
      request(ROOT, "org.freedesktop.DBus.Properties", "Set", "ssv", [
        SERVICE,
        "WirelessEnabled",
        { signature: "b", value: enabled },
      ]),
    ),
  );

/** Ask for a scan. Networks it finds arrive as changes. */
export const scanNetworkManagerWifi = async (
  system: NetworkSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> =>
  done(
    await system.dbusCall(
      request(wifi.device, WIRELESS, "RequestScan", "a{sv}", [{}]),
    ),
  );

/**
 * Join `network`: through its saved profile if it has one, or with a new
 * profile, which needs `passphrase` when the network is secured.
 */
export const connectNetworkManagerWifi = async (
  system: NetworkSystem,
  wifi: WifiDevice,
  network: WifiNetwork,
  passphrase: string | undefined,
): Promise<Result<"done", SystemError>> =>
  done(
    await system.dbusCall(
      network.profile === undefined
        ? request(ROOT, SERVICE, "AddAndActivateConnection", "a{sa{sv}}oo", [
            newProfile(network, passphrase),
            wifi.device,
            network.path,
          ])
        : request(ROOT, SERVICE, "ActivateConnection", "ooo", [
            network.profile,
            wifi.device,
            network.path,
          ]),
    ),
  );

/** Leave the current network, until asked to join one. */
export const disconnectNetworkManagerWifi = async (
  system: NetworkSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> =>
  done(
    await system.dbusCall({
      bus: Bus.System,
      destination: SERVICE,
      interface: DEVICE,
      member: "Disconnect",
      path: wifi.device,
    }),
  );

const request = (
  path: string,
  iface: string,
  member: string,
  signature: string,
  body: unknown[],
): DbusCall => ({
  body,
  bus: Bus.System,
  destination: SERVICE,
  interface: iface,
  member,
  path,
  signature,
});

const done = <T extends NonNullable<unknown>>(
  reply: Result<T, SystemError>,
): Result<"done", SystemError> => reply.map(() => "done");

/** The settings NetworkManager fills in a profile from, past the access point. */
const newProfile = (
  network: WifiNetwork,
  passphrase: string | undefined,
): Record<string, Record<string, { signature: string; value: string }>> => {
  if (!network.secured) {
    return {};
  } else if (passphrase === undefined) {
    throw new Error(`joining ${network.ssid} needs a passphrase`);
  } else {
    return {
      "802-11-wireless-security": {
        "key-mgmt": { signature: "s", value: "wpa-psk" },
        psk: { signature: "s", value: passphrase },
      },
    };
  }
};

/**
 * Read Wi-Fi. A property change on an object read for it matters, as does an
 * access point or a device coming or going.
 */
const read = async (system: NetworkSystem): Promise<Reading<Option<Wifi>>> => {
  const paths = new Set([ROOT]);
  const value = await readWifi(system, paths);
  return { matters: (signal) => matters(paths, signal), value };
};

const matters = (paths: ReadonlySet<string>, signal: DbusSignal): boolean => {
  switch (signal.member) {
    case "AccessPointAdded":
    case "AccessPointRemoved":
    case "DeviceAdded":
    case "DeviceRemoved": {
      return true;
    }
    case "PropertiesChanged": {
      return (
        signal.interface === "org.freedesktop.DBus.Properties" &&
        paths.has(signal.path)
      );
    }
    default: {
      return false;
    }
  }
};

/** Read Wi-Fi, adding each object read to `paths`. */
const readWifi = async (
  system: NetworkSystem,
  paths: Set<string>,
): Promise<Found> =>
  (await properties(system, ROOT, SERVICE, rootSchema)).andThenAsync(
    async ({ WirelessEnabled: enabled }) =>
      (await call(system, ROOT, SERVICE, "GetDevices")).andThenAsync(
        async ({ body }) => {
          const listed = devicesSchema.parse(body)[0];
          for (const path of listed) {
            paths.add(path);
          }
          const devices = Result.collect(
            await Promise.all(
              listed.map(async (path) =>
                (await properties(system, path, DEVICE, deviceSchema)).map(
                  (device) => ({ device, path }),
                ),
              ),
            ),
          );
          return devices.andThenAsync(async (read) => {
            const found = read.find(
              ({ device }) => device.DeviceType === WIFI_DEVICE,
            );
            return found === undefined
              ? Ok<Option<Wifi>, SystemError>(None())
              : (
                  await wifiOf(system, paths, found.path, found.device, enabled)
                ).map((wifi) => Some(wifi));
          });
        },
      ),
  );

/** The Wi-Fi device at `path`. */
const wifiOf = async (
  system: NetworkSystem,
  paths: Set<string>,
  path: string,
  device: Device,
  enabled: boolean,
): Promise<Result<Wifi, SystemError>> =>
  (await properties(system, path, WIRELESS, wirelessSchema)).andThenAsync(
    async (radio) => {
      for (const point of radio.AccessPoints) {
        paths.add(point);
      }
      paths.add(device.Ip4Config);
      const [points, profiles, ip] = await Promise.all([
        accessPoints(system, radio.AccessPoints),
        savedProfiles(system, device.AvailableConnections),
        radio.ActiveAccessPoint === NO_OBJECT || device.Ip4Config === NO_OBJECT
          ? Promise.resolve(Ok<Option<Ip>, SystemError>(None()))
          : ipOf(system, device.Ip4Config),
      ]);
      return points.andThen((read) =>
        profiles.andThen((saved) =>
          ip.map((address) => ({
            backend: WifiBackend.NetworkManager,
            connection: connectionOf(read, radio, address),
            device: path,
            enabled,
            hardwareAddress: device.HwAddress,
            interface: device.Interface,
            networks: networksOf(read, saved, radio.ActiveAccessPoint),
            scanning: false,
          })),
        ),
      );
    },
  );

/** An access point, by its path. */
type Point = AccessPoint & { path: string };

const accessPoints = async (
  system: NetworkSystem,
  listed: readonly string[],
): Promise<Result<Point[], SystemError>> =>
  Result.collect(
    await Promise.all(
      listed.map(async (path) =>
        (
          await properties(
            system,
            path,
            `${SERVICE}.AccessPoint`,
            accessPointSchema,
          )
        ).map((point) => ({ ...point, path })),
      ),
    ),
  );

/** Each saved Wi-Fi profile's path, by its network's name. */
const savedProfiles = async (
  system: NetworkSystem,
  listed: readonly string[],
): Promise<Result<Map<string, string>, SystemError>> =>
  Result.collect(
    await Promise.all(
      listed.map(async (path) =>
        (
          await call(
            system,
            path,
            `${SERVICE}.Settings.Connection`,
            "GetSettings",
          )
        ).map(({ body }) => ({
          path,
          settings: settingsSchema.parse(body)[0],
        })),
      ),
    ),
  ).map(
    (saved) =>
      new Map(
        saved.flatMap(({ path, settings }) => {
          const ssid = settings["802-11-wireless"]?.ssid;
          return ssid === undefined ? [] : [[ssid, path] as const];
        }),
      ),
  );

const ipOf = async (
  system: NetworkSystem,
  path: string,
): Promise<Result<Option<Ip>, SystemError>> =>
  (await properties(system, path, `${SERVICE}.IP4Config`, ip4Schema)).map(
    (config) =>
      Some({
        addresses: config.AddressData.map(
          ({ address, prefix }) => `${address}/${prefix}`,
        ),
        dns: config.NameserverData.map(({ address }) => address),
        gateway: config.Gateway === "" ? undefined : config.Gateway,
      }),
  );

/** The named networks, one per name: its strongest access point. */
const networksOf = (
  points: readonly Point[],
  profiles: ReadonlyMap<string, string>,
  active: string,
): WifiNetwork[] => {
  const byName = new Map<string, Point[]>();
  for (const point of points.filter(({ Ssid }) => Ssid !== "")) {
    byName.set(point.Ssid, [...(byName.get(point.Ssid) ?? []), point]);
  }
  return [...byName.values()]
    .map((named) => {
      const [strongest] = named.toSorted((a, b) => b.Strength - a.Strength);
      if (strongest === undefined) {
        throw new Error("a network with no access point");
      } else {
        return {
          connected: named.some(({ path }) => path === active),
          path: strongest.path,
          profile: profiles.get(strongest.Ssid),
          secured: isSecured(strongest),
          ssid: strongest.Ssid,
          strength: strongest.Strength / 100,
        };
      }
    })
    .toSorted((a, b) => b.strength - a.strength);
};

const connectionOf = (
  points: readonly Point[],
  radio: Wireless,
  ip: Option<Ip>,
): WifiConnection | undefined => {
  const active = points.find(({ path }) => path === radio.ActiveAccessPoint);
  return active === undefined
    ? undefined
    : {
        bitrate: radio.Bitrate / 1000,
        frequency: active.Frequency,
        ip: ip.match({ None: () => undefined, Some: (address) => address }),
        ssid: active.Ssid,
        strength: active.Strength / 100,
      };
};

/** `NM_802_11_AP_FLAGS_PRIVACY`, or any WPA or RSN flag. */
const isSecured = (point: AccessPoint): boolean =>
  (point.Flags & 1) !== 0 || point.WpaFlags !== 0 || point.RsnFlags !== 0;

const call = (
  system: NetworkSystem,
  path: string,
  iface: string,
  member: string,
) =>
  system.dbusCall({
    bus: Bus.System,
    destination: SERVICE,
    interface: iface,
    member,
    path,
  });

/** `Properties.GetAll` on one of NetworkManager's objects, parsed. */
const properties = async <T extends NonNullable<unknown>>(
  system: NetworkSystem,
  path: string,
  interfaceName: string,
  schema: z.ZodType<T>,
): Promise<Result<T, SystemError>> =>
  (
    await system.dbusCall({
      body: [interfaceName],
      bus: Bus.System,
      destination: SERVICE,
      interface: "org.freedesktop.DBus.Properties",
      member: "GetAll",
      path,
      signature: "s",
    })
  ).map(({ body }) => z.tuple([schema]).parse(body)[0]);

/** An SSID's bytes, as text. */
const ssid = z
  .array(z.number())
  .transform((bytes) => new TextDecoder().decode(new Uint8Array(bytes)));

const rootSchema = z.object({ WirelessEnabled: variant(z.boolean()) });

const devicesSchema = z.tuple([z.array(z.string())]);

const deviceSchema = z.object({
  AvailableConnections: variant(z.array(z.string())),
  DeviceType: variant(z.number()),
  HwAddress: variant(z.string()),
  Interface: variant(z.string()),
  Ip4Config: variant(z.string()),
});

type Device = z.infer<typeof deviceSchema>;

const wirelessSchema = z.object({
  AccessPoints: variant(z.array(z.string())),
  ActiveAccessPoint: variant(z.string()),
  /** In kbit/s. */
  Bitrate: variant(z.number()),
});

type Wireless = z.infer<typeof wirelessSchema>;

const accessPointSchema = z.object({
  Flags: variant(z.number()),
  Frequency: variant(z.number()),
  RsnFlags: variant(z.number()),
  Ssid: variant(ssid),
  Strength: variant(z.number()),
  WpaFlags: variant(z.number()),
});

type AccessPoint = z.infer<typeof accessPointSchema>;

const settingsSchema = z.tuple([
  z.object({
    "802-11-wireless": z.object({ ssid: variant(ssid).optional() }).optional(),
  }),
]);

const ip4Schema = z.object({
  AddressData: variant(
    z.array(
      z.object({
        address: variant(z.string()),
        prefix: variant(z.number()),
      }),
    ),
  ),
  Gateway: variant(z.string()),
  NameserverData: variant(z.array(z.object({ address: variant(z.string()) }))),
});
