import type { Option, Result } from "@cprussin/option-result";
import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { Switch } from "@domicile-desktop/component-library/Switch";
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
import { useEffect, useState } from "react";
import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import type { Addresses } from "./addressing";
import { addressRowsOf } from "./addressing";
import type { Value } from "./Details";
import { Details } from "./Details";
import { signalOf } from "./signal";
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
 * The Wi-Fi panel: a switch for the radio, the connection and its details,
 * and the networks in range, each joined with a click.
 *
 * Scans when shown. A refusal shows where it was asked; the service's state
 * shows the rest.
 */
export const WifiPanel = ({ actions, addresses, host, wifi }: Props) => {
  if (wifi === undefined) {
    return <span className={noteStyles}>Reading Wi-Fi…</span>;
  } else {
    return wifi.match({
      Err: (error) => <span className={noteStyles}>{error.message}</span>,
      Ok: (found) =>
        found.match({
          None: () => <span className={noteStyles}>No Wi-Fi device</span>,
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
  return (
    <div className={panelStyles}>
      <div className={headStyles}>
        <Switch
          checked={wifi.enabled}
          label="Wi-Fi"
          onCheckedChange={(checked) => {
            requests.run("power", () =>
              actions.setWifiEnabled(host, wifi, checked),
            );
          }}
        />
        {wifi.enabled && (
          <button
            aria-label="Scan"
            className={iconButtonStyles}
            disabled={scanning}
            onClick={() => {
              requests.run("scan", () => actions.scanWifi(host, wifi));
            }}
            title="Scan"
            type="button"
          >
            <ArrowClockwiseIcon size={14} />
          </button>
        )}
      </div>
      <Failure error={requests.failed("power")} />
      {wifi.enabled ? (
        <>
          <ScanOnShow
            actions={actions}
            host={host}
            run={requests.run}
            wifi={{ backend, device, interface: name }}
          />
          {scanning && <span className={noteStyles}>Scanning…</span>}
          <Failure error={requests.failed("scan")} />
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
          <ul aria-label="Networks" className={listStyles}>
            {wifi.networks
              .filter((network) => !network.connected)
              .map((network) => (
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
          </ul>
        </>
      ) : (
        <span className={noteStyles}>Wi-Fi is off</span>
      )}
    </div>
  );
};

/** Scans once, when shown with the radio on. */
const ScanOnShow = ({
  actions,
  host,
  run,
  wifi: { backend, device, interface: name },
}: {
  actions: WifiActions;
  host: Domicile;
  run: ReturnType<typeof useRequests>["run"];
  wifi: WifiDevice;
}) => {
  useEffect(() => {
    run("scan", () =>
      actions.scanWifi(host, { backend, device, interface: name }),
    );
  }, [actions, backend, device, host, name, run]);
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
  <section
    aria-label={`Connected to ${connection.ssid}`}
    className={connectionStyles}
  >
    <div className={headStyles}>
      <span className={ssidStyles}>
        <WifiSignalIcon strength={connection.strength} />
        <span className={nameStyles}>{connection.ssid}</span>
      </span>
      <Button loading={pending} onClick={onDisconnect} size="xs">
        Disconnect
      </Button>
    </div>
    <Failure error={failed} />
    <Details rows={detailsOf(wifi, connection, addresses)} />
  </section>
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
  <li className={rowStyles}>
    <button
      aria-busy={pending}
      aria-label={labelOf(network)}
      className={networkStyles}
      onClick={onPick}
      type="button"
    >
      <WifiSignalIcon strength={network.strength} />
      <span className={nameStyles}>{network.ssid}</span>
      {network.profile !== undefined && (
        <span className={noteStyles}>Saved</span>
      )}
      {pending && <span className={noteStyles}>Connecting…</span>}
      {network.secured && <LockSimpleIcon aria-hidden size={12} />}
    </button>
    {asking && <Passphrase onJoin={onJoin} ssid={network.ssid} />}
    <Failure error={failed} />
  </li>
);

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
      <Button size="xs" type="submit">
        Join
      </Button>
    </form>
  );
};

const Failure = ({ error }: { error: SystemError | undefined }) =>
  error !== undefined && <span className={errorStyles}>{error.message}</span>;

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

/**
 * The connection's details, leaving out what is unknown. The addresses come
 * from `ip`, since iwd reports none and NetworkManager only IPv4's here.
 */
const detailsOf = (
  wifi: Wifi,
  connection: WifiConnection,
  addresses: Addresses,
): (readonly [string, Value])[] => [
  ["Signal", `${Math.round(connection.strength * 100)}%`],
  ...(connection.frequency === undefined
    ? []
    : [["Frequency", frequencyOf(connection.frequency)] as const]),
  ...(connection.bitrate === undefined
    ? []
    : [["Speed", `${Math.round(connection.bitrate)} Mbit/s`] as const]),
  ...addressRowsOf(addresses, wifi.interface),
  ...(connection.ip === undefined
    ? []
    : [["DNS", connection.ip.dns.join(", ")] as const]),
  ["Interface", wifi.interface],
  ["Hardware address", wifi.hardwareAddress],
];

/** A frequency in MHz, with its band. */
const frequencyOf = (mhz: number): string => `${mhz} MHz (${bandOf(mhz)})`;

const bandOf = (mhz: number): string => {
  if (mhz < 3000) {
    return "2.4 GHz";
  } else if (mhz < 5925) {
    return "5 GHz";
  } else {
    return "6 GHz";
  }
};

const panelStyles = flex({ direction: "column", gap: 2 });

const headStyles = hstack({
  gap: 2,
  justify: "space-between",
});

const ssidStyles = hstack({ gap: 1.5 });

const connectionStyles = flex({
  borderBlock: "1px solid color-mix(in oklab, currentcolor 15%, transparent)",
  direction: "column",
  gap: 1,
  paddingBlock: 2,
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowY: "auto",
  padding: 0,
});

const rowStyles = flex({
  direction: "column",
  gap: 1,
});

// A row of the list, not a control: no frame until hovered.
const networkStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  },
  backgroundColor: "transparent",
  borderRadius: "md",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  gap: 1.5,
  paddingBlock: 1,
  paddingInline: 1.5,
  textAlign: "start",
});

const nameStyles = css({
  flex: "1 1 auto",
  minInlineSize: 0,
  overflowWrap: "anywhere",
});

const formStyles = hstack({ gap: 1.5, paddingInlineStart: 6 });

const noteStyles = css({ opacity: 0.75 });

const errorStyles = css({ color: "warning" });

// Matches the mixer's icon buttons.
const iconButtonStyles = css({
  _disabled: { cursor: "wait", opacity: "disabled" },
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  padding: 0,
});
