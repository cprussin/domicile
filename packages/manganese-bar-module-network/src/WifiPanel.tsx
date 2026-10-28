import type { Option, Result } from "@cprussin/option-result";
import { Button } from "@domicile-desktop/component-library/Button";
import type { Detail } from "@domicile-desktop/component-library/DetailList";
import { DetailList } from "@domicile-desktop/component-library/DetailList";
import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { Input } from "@domicile-desktop/component-library/Input";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { Loading } from "@domicile-desktop/component-library/Loading";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Switch } from "@domicile-desktop/component-library/Switch";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import { useRequests } from "@domicile-desktop/manganese-host/useRequests";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Wifi,
  WifiConnection,
  WifiDevice,
  WifiNetwork,
} from "@domicile-desktop/system-network/wifi";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { hstack } from "../styled-system/patterns";
import type { Addresses } from "./addressing";
import { addressRowsOf } from "./addressing";
import { signalOf } from "./signal";
import { speedOf } from "./speed";
import { WifiSignalIcon } from "./WifiSignalIcon";
import type { WifiActions } from "./wifi-actions";

type Props = {
  /** `undefined` until the service answers. */
  wifi: Result<Option<Wifi>, SystemError> | undefined;
  /** Each interface's addresses, from `ip`, which every backend's machine has. */
  addresses: Addresses;
  /** Where requests go. */
  host: Domicile;
  actions: WifiActions;
};

/**
 * The Wi-Fi section: a switch for the radio on its heading, the connection
 * with its details folded away, then the other networks in range, each
 * joined with a click. Nothing without a Wi-Fi device.
 *
 * Scans when shown. A refusal shows plainly where it was asked, with the
 * service's words in its tooltip; the service's state shows the rest.
 */
export const WifiPanel = ({ actions, addresses, host, wifi }: Props) => {
  if (wifi === undefined) {
    return (
      <PanelSection label="Wi-Fi">
        <Loading>Checking Wi-Fi…</Loading>
      </PanelSection>
    );
  } else {
    return wifi.match({
      Err: (error) => (
        <PanelSection label="Wi-Fi">
          <PanelNote detail={error.message} tone="warning">
            Couldn't read Wi-Fi
          </PanelNote>
        </PanelSection>
      ),
      Ok: (found) =>
        found.match({
          None: () => undefined,
          Some: (device) => (
            <Controls
              actions={actions}
              addresses={addresses}
              host={host}
              wifi={device}
            />
          ),
        }),
    });
  }
};

type ControlsProps = {
  wifi: Wifi;
  addresses: Addresses;
  host: Domicile;
  actions: WifiActions;
};

const Controls = ({ actions, addresses, host, wifi }: ControlsProps) => {
  const requests = useRequests();
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const { backend, device, interface: name } = wifi;
  const scanning = wifi.scanning || requests.pending("scan");
  const join = (network: WifiNetwork, passphrase: string | undefined) => {
    setAsking(undefined);
    requests.run(network.path, () =>
      actions.connectWifi(host, wifi, network, passphrase),
    );
  };
  const others = wifi.networks.filter((network) => !network.connected);
  // Nothing else in range, and not looking for more.
  const alone = !scanning && others.length === 0;
  return (
    <PanelSection
      action={
        <span className={headStyles}>
          {wifi.enabled && (
            <Tooltip
              content="Scan"
              tone="overPhoto"
              trigger={
                <IconButton
                  disabled={scanning}
                  label="Scan"
                  onClick={() => {
                    requests.run("scan", () => actions.scanWifi(host, wifi));
                  }}
                >
                  <ArrowClockwiseIcon aria-hidden size={14} weight="bold" />
                </IconButton>
              }
            />
          )}
          <Switch
            checked={wifi.enabled}
            hideLabel
            label="Wi-Fi"
            onCheckedChange={(checked) => {
              requests.run("power", () =>
                actions.setWifiEnabled(host, wifi, checked),
              );
            }}
          />
        </span>
      }
      label="Wi-Fi"
    >
      <Failure error={requests.failed("power")}>
        {wifi.enabled ? "Couldn't turn Wi-Fi off" : "Couldn't turn Wi-Fi on"}
      </Failure>
      {wifi.enabled ? (
        <>
          <ScanOnShow
            actions={actions}
            host={host}
            wifi={{ backend, device, interface: name }}
          />
          {alone && wifi.connection === undefined ? (
            <EmptyState
              hint="Move closer to your router, or try again in a moment."
              icon={MagnifyingGlassIcon}
              title="No networks found"
            />
          ) : (
            <List label="Networks">
              {wifi.connection !== undefined && (
                <Connection
                  addresses={addresses}
                  connection={wifi.connection}
                  failed={requests.failed("disconnect")}
                  onDisconnect={() => {
                    requests.run("disconnect", () =>
                      actions.disconnectWifi(host, wifi),
                    );
                  }}
                  pending={requests.pending("disconnect")}
                  wifi={wifi}
                />
              )}
              {others.map((network) => (
                <NetworkRow
                  asking={asking === network.path}
                  failed={requests.failed(network.path)}
                  key={network.path}
                  network={network}
                  onJoin={(passphrase) => {
                    join(network, passphrase);
                  }}
                  onPick={() => {
                    if (needsPassphrase(network)) {
                      setAsking(network.path);
                    } else {
                      join(network, undefined);
                    }
                  }}
                  pending={requests.pending(network.path)}
                />
              ))}
            </List>
          )}
          {scanning && <Loading layout="row">Looking for networks…</Loading>}
          {alone && wifi.connection !== undefined && (
            <PanelNote>No other networks nearby</PanelNote>
          )}
          <Failure error={requests.failed("scan")}>
            Couldn't look for networks
          </Failure>
        </>
      ) : (
        <EmptyState
          hint="Turn it on to see networks nearby."
          icon={WifiSlashIcon}
          title="Wi-Fi is off"
        />
      )}
    </PanelSection>
  );
};

/**
 * Scans once, when shown with the radio on. Nobody asked for it, so a
 * refusal is logged rather than shown; the Scan button shows its own.
 */
const ScanOnShow = ({
  actions,
  host,
  wifi: { backend, device, interface: name },
}: {
  actions: WifiActions;
  host: Domicile;
  wifi: WifiDevice;
}) => {
  useEffect(() => {
    actions.scanWifi(host, { backend, device, interface: name }).then(
      (result) => {
        result.match({
          Err: (error) => {
            // biome-ignore lint/suspicious/noConsole: nothing in the panel shows it
            console.error("The Wi-Fi service refused to scan", error);
          },
          Ok: () => undefined,
        });
      },
      (error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a background failure
        console.error("Failed to scan for Wi-Fi networks", error);
      },
    );
  }, [actions, backend, device, host, name]);
  return undefined;
};

type ConnectionProps = {
  wifi: Wifi;
  addresses: Addresses;
  connection: WifiConnection;
  pending: boolean;
  failed: SystemError | undefined;
  onDisconnect: () => void;
};

const Connection = ({
  addresses,
  connection,
  failed,
  onDisconnect,
  pending,
  wifi,
}: ConnectionProps) => (
  <ListRow
    detail={summaryOf(connection)}
    disclosure="Details"
    icon={<WifiSignalIcon strength={connection.strength} />}
    label={connection.ssid}
    surface="filled"
  >
    <DetailList rows={detailsOf(wifi, connection, addresses)} />
    <span>
      <Button loading={pending} onClick={onDisconnect} rounded size="xs">
        Disconnect
      </Button>
    </span>
    <Failure error={failed}>Couldn't disconnect</Failure>
  </ListRow>
);

type NetworkRowProps = {
  network: WifiNetwork;
  /** Whether its passphrase field is open. */
  asking: boolean;
  pending: boolean;
  failed: SystemError | undefined;
  onPick: () => void;
  onJoin: (passphrase: string) => void;
};

const NetworkRow = ({
  asking,
  failed,
  network,
  onJoin,
  onPick,
  pending,
}: NetworkRowProps) => (
  <ListRow
    busy={pending}
    detail={noteOf(network, pending)}
    end={
      network.secured ? (
        <LockSimpleIcon aria-hidden size={12} weight="bold" />
      ) : undefined
    }
    icon={<WifiSignalIcon strength={network.strength} />}
    label={network.ssid}
    name={labelOf(network)}
    onPress={onPick}
  >
    {(asking || failed !== undefined) && (
      <>
        {asking && <Passphrase onJoin={onJoin} ssid={network.ssid} />}
        <Failure error={failed}>Couldn't connect to {network.ssid}</Failure>
      </>
    )}
  </ListRow>
);

/** What a network's row says under its name, if anything. */
const noteOf = (network: WifiNetwork, pending: boolean): string | undefined => {
  if (pending) {
    return "Connecting…";
  } else if (network.profile === undefined) {
    return undefined;
  } else {
    return "Saved";
  }
};

/** The field for a new secured network's passphrase. */
const Passphrase = ({
  onJoin,
  ssid,
}: {
  ssid: string;
  onJoin: (passphrase: string) => void;
}) => {
  const [passphrase, setPassphrase] = useState("");
  return (
    <form
      className={formStyles}
      onSubmit={(event) => {
        event.preventDefault();
        onJoin(passphrase);
      }}
    >
      <Input
        aria-label={`Passphrase for ${ssid}`}
        autoFocus
        onValueChange={setPassphrase}
        size="xs"
        type="password"
        value={passphrase}
      />
      <Button size="xs" type="submit" variant="accent">
        Join
      </Button>
    </form>
  );
};

/** What failed, in plain words, with the service's in its tooltip. */
const Failure = ({
  children,
  error,
}: {
  children: ReactNode;
  error: SystemError | undefined;
}) =>
  error !== undefined && (
    <PanelNote detail={error.message} tone="warning">
      {children}
    </PanelNote>
  );

/** A new secured network, whose passphrase the service does not know. */
const needsPassphrase = (network: WifiNetwork): boolean =>
  network.secured && network.profile === undefined;

/** Its name, what it is, and its signal, for its button. */
const labelOf = (network: WifiNetwork): string =>
  [
    network.ssid,
    ...(network.profile === undefined ? [] : ["saved"]),
    ...(network.secured ? ["secured"] : []),
    `${signalOf(network.strength)} signal`,
  ].join(", ");

/** The connection at a glance: that it is the one in use, its signal and band. */
const summaryOf = (connection: WifiConnection): string =>
  [
    "Connected",
    `${signalOf(connection.strength)} signal`,
    ...(connection.frequency === undefined
      ? []
      : [bandOf(connection.frequency)]),
  ].join(" · ");

/**
 * The connection's details, leaving out what is unknown. The addresses come
 * from `ip`, since iwd reports none and NetworkManager only IPv4's here.
 */
const detailsOf = (
  wifi: Wifi,
  connection: WifiConnection,
  addresses: Addresses,
): Detail[] => [
  ...(connection.bitrate === undefined
    ? []
    : [["Speed", speedOf(connection.bitrate)] as const]),
  ...addressRowsOf(addresses, wifi.interface),
  ...(connection.ip === undefined
    ? []
    : [["DNS", connection.ip.dns.join(", ")] as const]),
  ["Interface", wifi.interface],
  ["Hardware address", wifi.hardwareAddress],
];

const bandOf = (mhz: number): string => {
  if (mhz < 3000) {
    return "2.4 GHz";
  } else if (mhz < 5925) {
    return "5 GHz";
  } else {
    return "6 GHz";
  }
};

const headStyles = hstack({ gap: 2 });

const formStyles = hstack({ gap: 1.5 });
