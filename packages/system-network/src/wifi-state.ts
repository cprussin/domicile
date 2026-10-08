// The Wi-Fi device as every backend reports it: its networks and its
// connection. See docs/SHELL-SYSTEM-ACCESS.md.

import type { System } from "@domicile-desktop/sdk/system";

/** The service that manages the Wi-Fi device. */
export enum WifiBackend {
  NetworkManager,
  Iwd,
}

/** A network in range. */
export type WifiNetwork = {
  /** The service's object for it: an access point (NetworkManager) or a network (iwd). */
  path: string;
  ssid: string;
  /** 0 through 1. */
  strength: number;
  secured: boolean;
  /** The saved profile: a connection (NetworkManager) or a known network (iwd). */
  profile: string | undefined;
  connected: boolean;
};

/** The addresses the service configured. */
export type Ip = {
  /** Each with its prefix, as `192.168.1.23/24`. */
  addresses: string[];
  gateway: string | undefined;
  dns: string[];
};

export type WifiConnection = {
  ssid: string;
  /** 0 through 1. */
  strength: number;
  /** In MHz. */
  frequency: number | undefined;
  /** In Mbit/s. */
  bitrate: number | undefined;
  /** `undefined` from iwd, which does not report addresses over D-Bus. */
  ip: Ip | undefined;
};

export type Wifi = {
  backend: WifiBackend;
  /** The device's object, which requests address. */
  device: string;
  interface: string;
  hardwareAddress: string;
  /** Whether the radio is on. */
  enabled: boolean;
  /** Whether a scan is running. Always `false` from NetworkManager, which does not say. */
  scanning: boolean;
  /** One per name, strongest first. Hidden networks are left out. */
  networks: WifiNetwork[];
  connection: WifiConnection | undefined;
};

/** What a request needs of the device. */
export type WifiDevice = Pick<Wifi, "backend" | "device" | "interface">;

/** The calls this library makes for Wi-Fi. */
export type WifiSystem = Pick<System, "dbusCall" | "dbusMatch" | "run">;
