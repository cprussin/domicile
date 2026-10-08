import { describe, expect, it } from "bun:test";
import type { Option } from "@cprussin/option-result";
import { Err, None, Ok } from "@cprussin/option-result";
import type { DbusCall } from "@domicile-desktop/sdk/system";

import { DONE, fakeBus, reports, SERVICE_UNKNOWN } from "./fake-bus";
import {
  connectWifi,
  disconnectWifi,
  scanWifi,
  setWifiEnabled,
  watchWifi,
} from "./wifi";
import type { Wifi } from "./wifi-state";
import { WifiBackend } from "./wifi-state";

const NETWORK_MANAGER = "org.freedesktop.NetworkManager";
const IWD = "net.connman.iwd";
const WPA_SUPPLICANT = "fi.w1.wpa_supplicant1";

/**
 * A bus where `owned` names have an owner. Every other call fails, so each
 * watch reports once.
 */
const busWith = (owned: readonly string[]) => {
  const bus = fakeBus((call: DbusCall) =>
    call.member === "NameHasOwner"
      ? Ok({ body: [owned.includes(String(call.body?.[0]))], signature: "b" })
      : Err(SERVICE_UNKNOWN),
  );
  return { ...bus, system: { ...bus.system, run: NO_RUN } };
};

/** Never called: nothing here joins a new secured network on iwd. */
const NO_RUN = () => {
  throw new Error("test: nothing should run");
};

describe("watchWifi", () => {
  it.each([
    [[NETWORK_MANAGER, IWD], NETWORK_MANAGER],
    [[IWD, WPA_SUPPLICANT], IWD],
  ])("with %p on the bus, watches %s", async (owned, watched) => {
    const bus = busWith(owned);
    const seen = reports<Option<Wifi>>();

    watchWifi(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    expect(bus.matches.map(({ sender }) => sender)).toStrictEqual([watched]);
  });

  it.each([[[WPA_SUPPLICANT]], [[]]])(
    "with %p on the bus, has no Wi-Fi to control",
    async (owned) => {
      const bus = busWith(owned);
      const seen = reports<Option<Wifi>>();

      watchWifi(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(Ok(None()));
      expect(bus.matches).toStrictEqual([]);
    },
  );

  it("reports the error when it cannot ask the bus", async () => {
    const bus = fakeBus(() => Err(SERVICE_UNKNOWN));
    const seen = reports<Option<Wifi>>();

    watchWifi({ ...bus.system, run: NO_RUN }, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  it("starts no watch once stopped", async () => {
    const bus = busWith([IWD]);
    const seen = reports<Option<Wifi>>();

    watchWifi(bus.system, seen.on)();
    await Bun.sleep(0);

    expect(bus.matches).toStrictEqual([]);
    expect(seen.pending).toBe(0);
  });
});

describe("Wi-Fi requests", () => {
  const wifi = (backend: WifiBackend): Wifi => ({
    backend,
    connection: undefined,
    device: "/device",
    enabled: true,
    hardwareAddress: "a4:c3:f0:85:ac:2d",
    interface: "wlan0",
    networks: [],
    scanning: false,
  });

  const network = {
    connected: false,
    path: "/network",
    profile: "/profile",
    secured: true,
    ssid: "Home",
    strength: 0.5,
  };

  it.each([
    ["setWifiEnabled", WifiBackend.NetworkManager, "Set", NETWORK_MANAGER],
    ["setWifiEnabled", WifiBackend.Iwd, "Set", IWD],
    ["scanWifi", WifiBackend.NetworkManager, "RequestScan", NETWORK_MANAGER],
    ["scanWifi", WifiBackend.Iwd, "Scan", IWD],
    [
      "connectWifi",
      WifiBackend.NetworkManager,
      "ActivateConnection",
      NETWORK_MANAGER,
    ],
    ["connectWifi", WifiBackend.Iwd, "Connect", IWD],
    [
      "disconnectWifi",
      WifiBackend.NetworkManager,
      "Disconnect",
      NETWORK_MANAGER,
    ],
    ["disconnectWifi", WifiBackend.Iwd, "Disconnect", IWD],
  ] as const)(
    "%s on backend %d calls %s on %s",
    async (name, backend, member, destination) => {
      const bus = fakeBus(() => Ok(DONE));
      const system = { ...bus.system, run: NO_RUN };
      const asks = {
        connectWifi: () =>
          connectWifi(system, wifi(backend), network, undefined),
        disconnectWifi: () => disconnectWifi(system, wifi(backend)),
        scanWifi: () => scanWifi(system, wifi(backend)),
        setWifiEnabled: () => setWifiEnabled(system, wifi(backend), false),
      };

      expect(await asks[name]()).toStrictEqual(Ok("done"));
      expect(
        bus.calls.map((call) => [call.member, call.destination]),
      ).toStrictEqual([[member, destination]]);
    },
  );
});
