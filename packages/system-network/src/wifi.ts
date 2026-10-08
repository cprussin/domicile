// The Wi-Fi device from whichever service manages it, NetworkManager or iwd,
// and the requests that change it. It also forwards the Wi-Fi types, which
// live in `wifi-state` so the backends can import them without a cycle. See
// docs/SHELL-SYSTEM-ACCESS.md.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import { hasOwner } from "./has-owner";
import {
  connectIwdWifi,
  disconnectIwdWifi,
  scanIwdWifi,
  setIwdWifiEnabled,
  watchIwdWifi,
} from "./iwd-wifi";
import {
  connectNetworkManagerWifi,
  disconnectNetworkManagerWifi,
  scanNetworkManagerWifi,
  setNetworkManagerWifiEnabled,
  watchNetworkManagerWifi,
} from "./networkmanager-wifi";
import type { Wifi, WifiDevice, WifiNetwork, WifiSystem } from "./wifi-state";
import { WifiBackend } from "./wifi-state";

export type {
  Ip,
  Wifi,
  WifiConnection,
  WifiDevice,
  WifiNetwork,
  WifiSystem,
} from "./wifi-state";
export { WifiBackend } from "./wifi-state";

/** Each backend's bus name, in the order they are tried. */
const BACKENDS: readonly (readonly [string, WifiBackend])[] = [
  ["org.freedesktop.NetworkManager", WifiBackend.NetworkManager],
  ["net.connman.iwd", WifiBackend.Iwd],
];

/**
 * Calls `onWifi` with the Wi-Fi device now and after each change, and returns
 * a function that stops watching.
 *
 * Watches the first of NetworkManager and iwd on the system bus when called.
 * `None` is no Wi-Fi device, or neither service: wpa_supplicant alone is not
 * controlled. An `Err` is a D-Bus failure.
 */
export const watchWifi = (
  system: WifiSystem,
  onWifi: (wifi: Result<Option<Wifi>, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { stop: undefined, stopped: false };
  detect(system, BACKENDS)
    .then((found) => {
      if (!watch.stopped) {
        found.match({
          Err: (error) => {
            onWifi(Err(error));
          },
          Ok: (backend) => {
            backend.match({
              None: () => {
                onWifi(Ok(None()));
              },
              Some: (chosen) => {
                watch.stop = watchBackend(chosen)(system, onWifi);
              },
            });
          },
        });
      }
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error("Failed to find a Wi-Fi service", error);
    });
  return () => {
    watch.stopped = true;
    watch.stop?.();
  };
};

/** Turn the radio on or off. */
export const setWifiEnabled = (
  system: WifiSystem,
  wifi: WifiDevice,
  enabled: boolean,
): Promise<Result<"done", SystemError>> => {
  switch (wifi.backend) {
    case WifiBackend.NetworkManager:
      return setNetworkManagerWifiEnabled(system, wifi, enabled);
    case WifiBackend.Iwd:
      return setIwdWifiEnabled(system, wifi, enabled);
  }
};

/** Ask for a scan. Networks it finds arrive through the watch. */
export const scanWifi = (
  system: WifiSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> => {
  switch (wifi.backend) {
    case WifiBackend.NetworkManager:
      return scanNetworkManagerWifi(system, wifi);
    case WifiBackend.Iwd:
      return scanIwdWifi(system, wifi);
  }
};

/**
 * Join `network`. A secured network with no saved profile needs `passphrase`;
 * the call throws without one.
 */
export const connectWifi = (
  system: WifiSystem,
  wifi: WifiDevice,
  network: WifiNetwork,
  passphrase: string | undefined,
): Promise<Result<"done", SystemError>> => {
  switch (wifi.backend) {
    case WifiBackend.NetworkManager:
      return connectNetworkManagerWifi(system, wifi, network, passphrase);
    case WifiBackend.Iwd:
      return connectIwdWifi(system, wifi, network, passphrase);
  }
};

/** Leave the current network. */
export const disconnectWifi = (
  system: WifiSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> => {
  switch (wifi.backend) {
    case WifiBackend.NetworkManager:
      return disconnectNetworkManagerWifi(system, wifi);
    case WifiBackend.Iwd:
      return disconnectIwdWifi(system, wifi);
  }
};

/** A watch's state, shared by its detection and its stop function. */
type Watch = { stop: (() => void) | undefined; stopped: boolean };

const watchBackend = (backend: WifiBackend): typeof watchNetworkManagerWifi => {
  switch (backend) {
    case WifiBackend.NetworkManager:
      return watchNetworkManagerWifi;
    case WifiBackend.Iwd:
      return watchIwdWifi;
  }
};

/** The first backend whose service has an owner on the bus, if any. */
const detect = async (
  system: WifiSystem,
  backends: readonly (readonly [string, WifiBackend])[],
): Promise<Result<Option<WifiBackend>, SystemError>> => {
  const [first, ...rest] = backends;
  if (first === undefined) {
    return Ok(None());
  } else {
    const [name, backend] = first;
    const owned = await hasOwner(system, name);
    return owned.match({
      Err: (error) => Promise.resolve(Err(error)),
      Ok: (has) =>
        has ? Promise.resolve(Ok(Some(backend))) : detect(system, rest),
    });
  }
};
