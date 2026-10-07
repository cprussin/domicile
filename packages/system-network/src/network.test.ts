import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { DbusCall } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";

import { fakeBus, reports, SERVICE_UNKNOWN } from "./fake-bus";
import { watchNetwork } from "./network";

const NETWORK_MANAGER = "org.freedesktop.NetworkManager";
const IWD = "net.connman.iwd";
const WPA_SUPPLICANT = "fi.w1.wpa_supplicant1";

/**
 * A bus where `owned` names have an owner. Every call to a backend fails, so
 * each watch reports once.
 */
const busWith = (owned: readonly string[]) =>
  fakeBus((call: DbusCall) =>
    call.member === "NameHasOwner"
      ? Ok({ body: [owned.includes(String(call.body?.[0]))], signature: "b" })
      : Err(SERVICE_UNKNOWN),
  );

/** The names a watch asked about, in order. */
const asked = (calls: readonly DbusCall[]) =>
  calls
    .filter(({ member }) => member === "NameHasOwner")
    .map(({ body }) => body?.[0]);

describe("watchNetwork", () => {
  it.each([
    [
      [NETWORK_MANAGER, IWD, WPA_SUPPLICANT],
      NETWORK_MANAGER,
      [NETWORK_MANAGER],
    ],
    [[IWD, WPA_SUPPLICANT], IWD, [NETWORK_MANAGER, IWD]],
    [[WPA_SUPPLICANT], WPA_SUPPLICANT, [NETWORK_MANAGER, IWD, WPA_SUPPLICANT]],
    [[], NETWORK_MANAGER, [NETWORK_MANAGER, IWD, WPA_SUPPLICANT]],
  ])("with %p on the bus, watches %s", async (owned, watched, names) => {
    const bus = busWith(owned);
    const seen = reports();

    watchNetwork(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    expect(bus.matches.map(({ sender }) => sender)).toStrictEqual([watched]);
    expect(asked(bus.calls)).toStrictEqual(names);
  });

  it("asks the bus without starting a service", async () => {
    const bus = busWith([NETWORK_MANAGER]);
    const seen = reports();

    watchNetwork(bus.system, seen.on);
    await seen.next();

    expect(bus.calls[0]).toStrictEqual({
      body: [NETWORK_MANAGER],
      bus: Bus.System,
      destination: "org.freedesktop.DBus",
      interface: "org.freedesktop.DBus",
      member: "NameHasOwner",
      path: "/org/freedesktop/DBus",
      signature: "s",
    });
  });

  it("reports the error when it cannot ask the bus", async () => {
    const bus = fakeBus(() => Err(SERVICE_UNKNOWN));
    const seen = reports();

    watchNetwork(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    expect(bus.matches).toStrictEqual([]);
  });

  it("starts no watch once stopped", async () => {
    const bus = busWith([IWD]);
    const seen = reports();

    watchNetwork(bus.system, seen.on)();
    await Bun.sleep(0);

    expect(bus.matches).toStrictEqual([]);
    expect(seen.pending).toBe(0);
  });

  it("stops the watch it started", async () => {
    const bus = busWith([IWD]);
    const seen = reports();
    const stop = watchNetwork(bus.system, seen.on);
    await seen.next();

    stop();

    expect(bus.stopped).toBe(1);
  });
});
