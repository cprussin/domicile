import type { Option, Result } from "@cprussin/option-result";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { useKeepsKeyboard } from "@domicile-desktop/manganese-bar/panel-keyboard";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Addressing,
  NetworkInterface,
} from "@domicile-desktop/system-network/interfaces";
import { InterfaceKind } from "@domicile-desktop/system-network/interfaces";
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
import { useMemo, useState } from "react";
import { cva } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import { signalOf } from "./signal";
import { WifiPanel } from "./WifiPanel";
import { WifiSignalIcon } from "./WifiSignalIcon";
import { WiredPanel } from "./WiredPanel";
import type { WifiActions } from "./wifi-actions";
import { WIFI_ACTIONS } from "./wifi-actions";

type Props = {
  /** The desk's network, from the network service. */
  network: SharedWatch<Result<Reading, SystemError>>;
  /** The network hardware, from `/sys`. */
  interfaces: SharedWatch<Result<NetworkInterface[], SystemError>>;
  /** Each interface's addresses, read while the panel is open. */
  addresses: SharedWatch<Result<Map<string, Addressing>, SystemError>>;
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
 * when the link does not reach the internet or the service fails. A click
 * opens the wired ports and the {@link WifiPanel}.
 *
 * An icon alone, so its width never changes with the name.
 *
 * Draws nothing until the service or the hardware answers, and nothing on a
 * machine with no network hardware.
 */
export const Network = ({
  actions = WIFI_ACTIONS,
  addresses,
  domicile,
  interfaces,
  network,
  wifi,
}: Props) => {
  const host = useMemo(() => desktop(domicile), [domicile]);
  const reading = useSharedWatch(network);
  const hardware = useSharedWatch(interfaces);
  const ports = hardware?.match({ Err: () => undefined, Ok: (found) => found });
  if (
    (reading === undefined && hardware === undefined) ||
    ports?.length === 0
  ) {
    return undefined;
  } else {
    return (
      <Item
        actions={actions}
        addresses={addresses}
        host={host}
        reading={reading}
        wifi={wifi}
        wired={(ports ?? []).filter(({ kind }) => kind === InterfaceKind.Wired)}
      />
    );
  }
};

/** What the icon shows. */
type Shown = { link: Link; label: string; online: boolean };

/**
 * The button and its panel. The panel keeps the keyboard while open, for
 * typing a Wi-Fi password.
 */
const Item = ({
  actions,
  addresses,
  host,
  reading,
  wifi,
  wired,
}: {
  actions: WifiActions;
  addresses: Props["addresses"];
  host: Domicile;
  reading: Result<Reading, SystemError> | undefined;
  wifi: Props["wifi"];
  wired: NetworkInterface[];
}) => {
  const { label, link, online } = shownOf(
    reading,
    wired.some(({ up }) => up),
  );
  const [open, setOpen] = useState(false);
  useKeepsKeyboard(open);
  return (
    <Popover
      align="center"
      onOpenChange={setOpen}
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
      <OpenPanel
        actions={actions}
        addresses={addresses}
        host={host}
        wifi={wifi}
        wired={wired}
      />
    </Popover>
  );
};

/**
 * The icon for the service's reading. A cable that is in shows as wired when
 * the service reports no link, as iwd and wpa_supplicant never do.
 */
const shownOf = (
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

/**
 * The panel, which watches Wi-Fi and the addresses while it is open. Its
 * width is fixed, so a long address wraps rather than widening it.
 */
const OpenPanel = ({
  actions,
  addresses,
  host,
  wifi,
  wired,
}: {
  actions: WifiActions;
  addresses: Props["addresses"];
  host: Domicile;
  wifi: Props["wifi"];
  wired: NetworkInterface[];
}) => {
  const addressing = useSharedWatch(addresses);
  return (
    <div className={panelStyles}>
      {wired.length > 0 && <WiredPanel addresses={addressing} ports={wired} />}
      <WifiPanel
        actions={actions}
        addresses={addressing}
        host={host}
        wifi={useSharedWatch(wifi)}
      />
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
      return <WifiSignalIcon label={label} strength={link.strength} />;
  }
};

const panelStyles = flex({ direction: "column", gap: 3, inlineSize: 104 });

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
      // Dims the icon alone, so the hover background stays as strong.
      false: { "& > svg": { opacity: "inactive" } },
      true: {},
    },
    online: {
      false: { color: "warning" },
      true: { color: "inherit" },
    },
  },
});

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
