import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Link,
  Network as Reading,
} from "@domicile-desktop/system-network/network";
import {
  Connectivity,
  LinkKind,
} from "@domicile-desktop/system-network/network";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";

import { signalOf } from "./signal";
import { WifiSignalIcon } from "./WifiSignalIcon";

/** What the icon shows. */
export type Shown = { link: Link; label: string; online: boolean };

/**
 * The icon for the service's reading. A cable that is in shows as wired when
 * the service reports no link, as iwd and wpa_supplicant never do.
 */
export const shownOf = (
  reading: Result<Reading, SystemError> | undefined,
  cabled: boolean,
): Shown => {
  if (reading === undefined) {
    return cabled
      ? { label: "Wired", link: WIRED, online: true }
      : { label: "Reading the network", link: NONE, online: true };
  } else {
    return reading.match({
      Err: (error): Shown =>
        cabled
          ? { label: "Wired", link: WIRED, online: true }
          : {
              label: `Network unavailable: ${error.message}`,
              link: NONE,
              online: false,
            },
      Ok: ({ connectivity, link }): Shown => {
        const online =
          connectivity !== Connectivity.Limited &&
          connectivity !== Connectivity.Portal;
        const shown = cabled && link.kind === LinkKind.None ? WIRED : link;
        const cable = cabled && shown.kind !== LinkKind.Wired ? "; Wired" : "";
        const named = `${nameOf(shown)}${cable}`;
        return {
          label: online ? named : `${named}, no internet`,
          link: shown,
          online,
        };
      },
    });
  }
};

/** A cable the service does not report. */
const WIRED: Link = { kind: LinkKind.Wired, name: "" };

const NONE: Link = { kind: LinkKind.None };

/** The icon for what {@link shownOf} shows. */
export const LinkIcon = ({ label, link }: { label: string; link: Link }) => {
  switch (link.kind) {
    case LinkKind.None:
      // The Wi-Fi icon, so a dropped connection slashes its arcs.
      return <WifiSignalIcon label={label} off strength={1} />;
    case LinkKind.Wired:
    case LinkKind.Other:
      return (
        <NetworkIcon aria-label={label} role="img" size={15} weight="bold" />
      );
    case LinkKind.Wifi:
      return <WifiSignalIcon label={label} strength={link.strength} />;
  }
};

/** What the icon shows, for its accessible name, with the Wi-Fi network's or VPN's name. */
const nameOf = (link: Link): string => {
  switch (link.kind) {
    case LinkKind.None:
      return "Offline";
    case LinkKind.Wired:
      return "Wired";
    case LinkKind.Wifi:
      return `Wi-Fi, ${signalOf(link.strength)} signal: ${link.ssid}`;
    case LinkKind.Other:
      return `Network: ${link.name}`;
  }
};
