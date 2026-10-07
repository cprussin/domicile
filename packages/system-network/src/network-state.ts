// The network as every backend reports it: connectivity and the primary
// connection. See docs/SHELL-SYSTEM-ACCESS.md.

import type { System } from "@domicile-desktop/sdk/system";

/** Whether the host reaches the internet. */
export enum Connectivity {
  Unknown,
  None,
  /** Behind a captive portal. */
  Portal,
  /** On a network, without the internet. */
  Limited,
  Full,
}

export enum LinkKind {
  None,
  Wired,
  Wifi,
  Other,
}

/** The primary connection. `name` is the connection's name in NetworkManager. */
export const Link = {
  None: () => ({ kind: LinkKind.None as const }),
  /** A VPN, a bridge, a modem and the rest. */
  Other: (name: string) => ({ kind: LinkKind.Other as const, name }),
  /** `strength` is 0 through 1. */
  Wifi: (ssid: string, strength: number) => ({
    kind: LinkKind.Wifi as const,
    ssid,
    strength,
  }),
  Wired: (name: string) => ({ kind: LinkKind.Wired as const, name }),
};

export type Link = ReturnType<(typeof Link)[keyof typeof Link]>;

export type Network = { connectivity: Connectivity; link: Link };

/** The calls this library makes. */
export type NetworkSystem = Pick<System, "dbusCall" | "dbusMatch">;
