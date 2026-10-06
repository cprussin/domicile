import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type {
  Link,
  Network as Reading,
} from "@domicile-desktop/system-network/network";
import {
  Connectivity,
  LinkKind,
  watchNetwork,
} from "@domicile-desktop/system-network/network";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import { WifiLowIcon } from "@phosphor-icons/react/dist/ssr/WifiLow";
import { WifiMediumIcon } from "@phosphor-icons/react/dist/ssr/WifiMedium";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import { useEffect, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

type Props = {
  /** The host whose system calls reach NetworkManager. */
  domicile: DomicileHost;
  /** Injectable so tests can drive their own network. */
  watch?: typeof watchNetwork | undefined;
};

/**
 * The network readout on the bar: an icon for the primary connection, and the
 * Wi-Fi network's or VPN's name. Turns `warning` when the link does not reach
 * the internet.
 *
 * Draws nothing until NetworkManager answers, and nothing on a D-Bus error,
 * so a machine without NetworkManager shows no readout.
 */
export const Network = ({ domicile, watch = watchNetwork }: Props) => {
  const [network, setNetwork] = useState<
    Result<Reading, SystemError> | undefined
  >(undefined);

  useEffect(() => watch(system(domicile), setNetwork), [domicile, watch]);

  return network?.match({
    Err: () => undefined,
    Ok: (reading) => <Readout network={reading} />,
  });
};

/** The readout once NetworkManager has answered. */
const Readout = ({ network: { connectivity, link } }: { network: Reading }) => {
  const online =
    connectivity !== Connectivity.Limited &&
    connectivity !== Connectivity.Portal;
  const label = online ? describe(link) : `${describe(link)}, no internet`;
  const name = nameOf(link);
  return (
    <div className={rootStyles({ online })}>
      <LinkIcon label={label} link={link} />
      {name === undefined ? undefined : (
        <span className={nameStyles}>{name}</span>
      )}
    </div>
  );
};

const LinkIcon = ({ label, link }: { label: string; link: Link }) => {
  switch (link.kind) {
    case LinkKind.None:
      return (
        <WifiSlashIcon aria-label={label} role="img" size={15} weight="bold" />
      );
    case LinkKind.Wired:
    case LinkKind.Other:
      return (
        <NetworkIcon aria-label={label} role="img" size={15} weight="bold" />
      );
    case LinkKind.Wifi:
      switch (signalOf(link.strength)) {
        case "strong":
          return (
            <WifiHighIcon
              aria-label={label}
              role="img"
              size={15}
              weight="bold"
            />
          );
        case "fair":
          return (
            <WifiMediumIcon
              aria-label={label}
              role="img"
              size={15}
              weight="bold"
            />
          );
        case "weak":
          return (
            <WifiLowIcon
              aria-label={label}
              role="img"
              size={15}
              weight="bold"
            />
          );
      }
  }
};

const rootStyles = cva({
  base: hstack.raw({ gap: 1 }),
  variants: {
    online: {
      false: { color: "warning" },
      true: {},
    },
  },
});

// 10px to match the bar's other figures; no font-size token fits.
const nameStyles = css({ fontSize: "0.625rem" });

/** The Wi-Fi signal's grade, by thirds. */
type Signal = "strong" | "fair" | "weak";

const signalOf = (strength: number): Signal => {
  if (strength >= 2 / 3) {
    return "strong";
  } else if (strength >= 1 / 3) {
    return "fair";
  } else {
    return "weak";
  }
};

/** What the icon shows, for its accessible name. */
const describe = (link: Link): string => {
  switch (link.kind) {
    case LinkKind.None:
      return "Offline";
    case LinkKind.Wired:
      return "Wired";
    case LinkKind.Wifi:
      return `Wi-Fi, ${signalOf(link.strength)} signal`;
    case LinkKind.Other:
      return "Network";
  }
};

/** The name shown beside the icon: the Wi-Fi network or VPN, not a cable. */
const nameOf = (link: Link): string | undefined => {
  switch (link.kind) {
    case LinkKind.Wifi:
      return link.ssid;
    case LinkKind.Other:
      return link.name;
    case LinkKind.None:
    case LinkKind.Wired:
      return undefined;
  }
};
