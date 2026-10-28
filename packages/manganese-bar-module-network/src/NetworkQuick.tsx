import type { Option, Result } from "@cprussin/option-result";
import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import { useRequests } from "@domicile-desktop/manganese-host/useRequests";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { NetworkInterface } from "@domicile-desktop/system-network/interfaces";
import { InterfaceKind } from "@domicile-desktop/system-network/interfaces";
import type { Network as Reading } from "@domicile-desktop/system-network/network";
import { LinkKind } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";

import { cva } from "../styled-system/css";
import { LinkIcon, shownOf } from "./link-shown";
import { speedOf } from "./speed";
import type { WifiActions } from "./wifi-actions";
import { WIFI_ACTIONS } from "./wifi-actions";

type GlyphProps = {
  /** The desk's network, from the network service. */
  network: SharedWatch<Result<Reading, SystemError>>;
  /** The network hardware, from `/sys`. */
  interfaces: SharedWatch<Result<NetworkInterface[], SystemError>>;
};

/**
 * The network icon in the quick settings button, as the network item draws
 * it: dimmed with no link, in `warning` without the internet. Nothing until
 * the service or the hardware answers, and nothing without network hardware.
 */
export const NetworkGlyph = ({ interfaces, network }: GlyphProps) => {
  const reading = useSharedWatch(network);
  const ports = useSharedWatch(interfaces)?.match({
    Err: () => undefined,
    Ok: (found) => found,
  });
  if ((reading === undefined && ports === undefined) || ports?.length === 0) {
    return undefined;
  } else {
    const { label, link, online } = shownOf(
      reading,
      (ports ?? []).some(({ kind, up }) => kind === InterfaceKind.Wired && up),
    );
    return (
      <span
        className={glyphStyles({
          linked: link.kind !== LinkKind.None,
          online,
        })}
      >
        <LinkIcon label={label} link={link} />
      </span>
    );
  }
};

type TilesProps = {
  /** The network hardware, from `/sys`. */
  interfaces: SharedWatch<Result<NetworkInterface[], SystemError>>;
  /** The Wi-Fi device, read while the tiles show. */
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
  /** The host whose system calls reach the Wi-Fi service. */
  domicile: Domicile;
  /** Opens the wired ports and the Wi-Fi panel. */
  onMore?: (() => void) | undefined;
  /** Injectable so tests can see what the tiles ask for. */
  actions?: WifiActions | undefined;
};

/**
 * The quick settings network tiles: Wi-Fi, which turns the radio on and off,
 * on a machine with a Wi-Fi device; and Wired, with a cable in or without
 * Wi-Fi. Nothing until Wi-Fi has been read.
 */
export const NetworkTiles = ({
  actions = WIFI_ACTIONS,
  domicile,
  interfaces,
  onMore,
  wifi,
}: TilesProps) => {
  const read = useSharedWatch(wifi);
  const ports = useSharedWatch(interfaces)?.match({
    Err: () => [],
    Ok: (found) => found,
  });
  const requests = useRequests();
  if (read === undefined || ports === undefined) {
    return undefined;
  } else {
    const device = read.match({
      Err: () => undefined,
      Ok: (found) =>
        found.match({ None: () => undefined, Some: (radio) => radio }),
    });
    const wired = ports.filter(({ kind }) => kind === InterfaceKind.Wired);
    const cable = wired.find(({ up }) => up);
    return (
      <>
        {device !== undefined && (
          <QuickTile
            detail={
              requests.failed("power") === undefined
                ? wifiDetailOf(device)
                : "Couldn't switch"
            }
            icon={<WifiHighIcon size={15} weight="bold" />}
            label="Wi-Fi"
            onMore={onMore}
            onPressedChange={(pressed) => {
              requests.run("power", () =>
                actions.setWifiEnabled(domicile, device, pressed),
              );
            }}
            pressed={device.enabled}
          />
        )}
        {wired.length > 0 &&
          (cable !== undefined || device === undefined) &&
          onMore !== undefined && (
            <QuickTile
              detail={cable === undefined ? "No cable" : cableDetailOf(cable)}
              icon={<NetworkIcon size={15} weight="bold" />}
              label="Wired"
              onMore={onMore}
            />
          )}
      </>
    );
  }
};

const wifiDetailOf = (device: Wifi): string => {
  if (device.enabled) {
    return device.connection?.ssid ?? "Not connected";
  } else {
    return "Off";
  }
};

const cableDetailOf = ({ speed }: NetworkInterface): string =>
  speed === undefined ? "Connected" : `Connected, ${speedOf(speed)}`;

const glyphStyles = cva({
  base: { display: "inline-flex", flexShrink: 0 },
  variants: {
    linked: {
      false: { opacity: "inactive" },
      true: {},
    },
    online: {
      false: { color: "warning" },
      true: {},
    },
  },
});
