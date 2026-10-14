import type { Option, Result } from "@cprussin/option-result";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type {
  Link,
  Network as Reading,
} from "@domicile-desktop/system-network/network";
import {
  Connectivity,
  LinkKind,
} from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import { useMemo } from "react";
import { cva } from "../styled-system/css";
import { signalOf } from "./signal";
import { WifiPanel } from "./WifiPanel";
import { WifiSignalIcon } from "./WifiSignalIcon";
import type { WifiActions } from "./wifi-actions";
import { WIFI_ACTIONS } from "./wifi-actions";

type Props = {
  /** The desk's network, from the network service. */
  network: SharedWatch<Result<Reading, SystemError>>;
  /** The Wi-Fi device, read while the panel is open. */
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
  /** The host whose system calls reach the Wi-Fi service. */
  domicile: DomicileHost;
  /** Injectable so tests can see what the panel asks for. */
  actions?: WifiActions | undefined;
};

/**
 * The network item on the bar: an icon for the primary connection, named on
 * hover with the Wi-Fi network or VPN. Dims with no link, and turns `warning`
 * when the link does not reach the internet. A click opens the
 * {@link WifiPanel}.
 *
 * An icon alone, so its width never changes with the name.
 *
 * Draws nothing until the network service answers, and nothing on an error,
 * so a machine without one shows no item.
 */
export const Network = ({
  actions = WIFI_ACTIONS,
  domicile,
  network,
  wifi,
}: Props) => {
  const host = useMemo(() => system(domicile), [domicile]);
  return useSharedWatch(network)?.match({
    Err: () => undefined,
    Ok: (reading) => (
      <Item actions={actions} host={host} network={reading} wifi={wifi} />
    ),
  });
};

/** The button and its panel once the network service has answered. */
const Item = ({
  actions,
  host,
  network: { connectivity, link },
  wifi,
}: {
  actions: WifiActions;
  host: System;
  network: Reading;
  wifi: Props["wifi"];
}) => {
  const online =
    connectivity !== Connectivity.Limited &&
    connectivity !== Connectivity.Portal;
  const name = nameOf(link);
  const named =
    name === undefined ? describe(link) : `${describe(link)}: ${name}`;
  const label = online ? named : `${named}, no internet`;
  return (
    <Popover
      align="center"
      side="bottom"
      tone="overPhoto"
      trigger={
        <button
          className={triggerStyles({
            linked: link.kind !== LinkKind.None,
            online,
          })}
          title={label}
          type="button"
        >
          <LinkIcon label={label} link={link} />
        </button>
      }
      wide
    >
      <OpenPanel actions={actions} host={host} wifi={wifi} />
    </Popover>
  );
};

/** The panel, which watches Wi-Fi while it is open. */
const OpenPanel = ({
  actions,
  host,
  wifi,
}: {
  actions: WifiActions;
  host: System;
  wifi: Props["wifi"];
}) => <WifiPanel actions={actions} host={host} wifi={useSharedWatch(wifi)} />;

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
      return <WifiSignalIcon label={label} strength={link.strength} />;
  }
};

// Matches the volume item's button.
const triggerStyles = cva({
  base: {
    _hover: {
      backgroundColor: "color-mix(in oklab, white 16%, transparent)",
    },
    alignItems: "center",
    backgroundColor: "transparent",
    blockSize: 7,
    borderRadius: "full",
    borderStyle: "none",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    inlineSize: 7,
    justifyContent: "center",
    padding: 0,
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    linked: {
      false: { opacity: "disabled" },
      true: {},
    },
    online: {
      false: { color: "warning" },
      true: { color: "inherit" },
    },
  },
});

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

/** The Wi-Fi network's or VPN's name; a cable or no link has none. */
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
