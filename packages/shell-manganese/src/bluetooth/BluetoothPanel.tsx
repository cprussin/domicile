import { Result } from "@cprussin/option-result";
import { Button } from "@domicile-desktop/component-library/Button";
import { Switch } from "@domicile-desktop/component-library/Switch";
import type { System } from "@domicile-desktop/sdk/system";
import type {
  Bluetooth,
  Device,
} from "@domicile-desktop/system-bluetooth/bluetooth";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { useRequests } from "../requests/useRequests";
import type { BluetoothActions } from "./bluetooth-actions";

type Props = {
  bluetooth: Bluetooth;
  /** Where requests go. */
  host: System;
  actions: BluetoothActions;
};

/**
 * The Bluetooth panel: a switch for every adapter, and the devices BlueZ
 * knows, each with its details and what can be done with it.
 *
 * Scans while shown, so new devices appear. Each device's refusal shows on
 * its row; BlueZ's state shows the rest.
 */
export const BluetoothPanel = ({ actions, bluetooth, host }: Props) => {
  const requests = useRequests();
  const powered = bluetooth.adapters.filter((adapter) => adapter.powered);
  const on = powered.length > 0;
  const power = requests.failed("power");
  return (
    <div className={panelStyles}>
      <Switch
        checked={on}
        label="Bluetooth"
        onCheckedChange={(checked) => {
          requests.run("power", async () => {
            const results = await Promise.all(
              bluetooth.adapters.map(({ path }) =>
                actions.setPowered(host, path, checked),
              ),
            );
            return Result.collect(results);
          });
        }}
      />
      {power !== undefined && (
        <span className={errorStyles}>{power.message}</span>
      )}
      {on ? (
        <>
          {powered.map(({ path }) => (
            <Discovery
              actions={actions}
              adapter={path}
              host={host}
              key={path}
            />
          ))}
          {bluetooth.adapters.some(({ discovering }) => discovering) && (
            <span className={noteStyles}>Searching for devices…</span>
          )}
          <ul className={listStyles}>
            {bluetooth.devices.toSorted(byStanding).map((device) => (
              <DeviceRow
                device={device}
                failed={requests.failed(device.path)?.message}
                key={device.path}
                onAsk={(request) => {
                  requests.run(device.path, () => request(host, actions));
                }}
                pending={requests.pending(device.path)}
              />
            ))}
          </ul>
        </>
      ) : (
        <span className={noteStyles}>Bluetooth is off</span>
      )}
    </div>
  );
};

/** Scans on `adapter` while shown. */
const Discovery = ({
  actions,
  adapter,
  host,
}: {
  actions: BluetoothActions;
  adapter: string;
  host: System;
}) => {
  useEffect(() => {
    report("start scanning", actions.startDiscovery(host, adapter));
    return () => {
      report("stop scanning", actions.stopDiscovery(host, adapter));
    };
  }, [actions, adapter, host]);
  return undefined;
};

/** A request a row makes, given where it goes. */
type Request = (
  host: System,
  actions: BluetoothActions,
) => ReturnType<BluetoothActions["connect"]>;

type DeviceRowProps = {
  device: Device;
  failed: string | undefined;
  pending: boolean;
  onAsk: (request: Request) => void;
};

const DeviceRow = ({ device, failed, onAsk, pending }: DeviceRowProps) => (
  <li className={rowStyles}>
    <span className={headStyles}>
      <span className={nameStyles}>{device.name}</span>
      <span className={noteStyles}>{detailsOf(device)}</span>
    </span>
    <Button
      loading={pending}
      onClick={() => {
        onAsk(primaryRequest(device));
      }}
      size="xs"
    >
      {primaryLabel(device)}
    </Button>
    {device.paired && (
      <button
        aria-label={`Forget ${device.name}`}
        className={iconButtonStyles}
        onClick={() => {
          onAsk((host, actions) => actions.forget(host, device));
        }}
        title="Forget"
        type="button"
      >
        <TrashIcon size={14} />
      </button>
    )}
    {failed !== undefined && <span className={errorStyles}>{failed}</span>}
  </li>
);

/** Disconnect a connected device, connect a paired one, or pair a new one. */
const primaryRequest = (device: Device): Request => {
  if (device.connected) {
    return (host, actions) => actions.disconnect(host, device.path);
  } else if (device.paired) {
    return (host, actions) => actions.connect(host, device.path);
  } else {
    return async (host, actions) =>
      (await actions.pair(host, device.path)).andThenAsync(() =>
        actions.connect(host, device.path),
      );
  }
};

const primaryLabel = (device: Device): string => {
  if (device.connected) {
    return "Disconnect";
  } else if (device.paired) {
    return "Connect";
  } else {
    return "Pair";
  }
};

/** Its standing, battery and address, as one line. */
const detailsOf = (device: Device): string =>
  [
    standingOf(device),
    ...(device.battery === undefined ? [] : [`Battery ${device.battery}%`]),
    device.address,
  ].join(" · ");

const standingOf = (device: Device): string => {
  if (device.connected) {
    return "Connected";
  } else if (device.paired) {
    return "Paired";
  } else {
    return "New";
  }
};

/** Connected first, then paired, then new; by name within each. */
const byStanding = (a: Device, b: Device): number =>
  rank(a) - rank(b) || a.name.localeCompare(b.name);

const rank = (device: Device): number => {
  if (device.connected) {
    return 0;
  } else if (device.paired) {
    return 1;
  } else {
    return 2;
  }
};

/** Sends a request whose outcome nothing shows, logging a failure. */
const report = (
  what: string,
  asking: ReturnType<BluetoothActions["startDiscovery"]>,
): void => {
  asking.then(
    (result) => {
      result.match({
        Err: (error) => {
          // biome-ignore lint/suspicious/noConsole: nothing in the panel shows it
          console.error(`BlueZ refused to ${what}`, error);
        },
        Ok: () => undefined,
      });
    },
    (error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error(`Failed to ${what}`, error);
    },
  );
};

const panelStyles = flex({
  direction: "column",
  gap: 2,
  inlineSize: 80,
});

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowY: "auto",
  padding: 0,
});

const rowStyles = hstack({
  flexWrap: "wrap",
  gap: 1.5,
});

const headStyles = flex({
  direction: "column",
  flex: "1 1 0",
  minInlineSize: 0,
});

const nameStyles = css({ overflowWrap: "anywhere" });

const noteStyles = css({ opacity: 0.75 });

// Under the row, across its width.
const errorStyles = css({ color: "warning", flexBasis: "100%" });

// Matches the mixer's icon buttons.
const iconButtonStyles = css({
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
