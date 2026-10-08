import type { Result } from "@cprussin/option-result";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Bluetooth as Reading } from "@domicile-desktop/system-bluetooth/bluetooth";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { BluetoothConnectedIcon } from "@phosphor-icons/react/dist/ssr/BluetoothConnected";
import { BluetoothSlashIcon } from "@phosphor-icons/react/dist/ssr/BluetoothSlash";
import { useMemo } from "react";

import { css } from "../../styled-system/css";
import type { SharedWatch } from "../readouts/shared-watch";
import { useSharedWatch } from "../readouts/useSharedWatch";
import { BluetoothPanel } from "./BluetoothPanel";
import type { BluetoothActions } from "./bluetooth-actions";
import { BLUETOOTH_ACTIONS } from "./bluetooth-actions";

type Props = {
  /** The desk's Bluetooth, from BlueZ. */
  bluetooth: SharedWatch<Result<Reading, SystemError>>;
  /** The host whose system calls reach BlueZ. */
  domicile: DomicileHost;
  /** Injectable so tests can see what the panel asks for. */
  actions?: BluetoothActions | undefined;
};

/**
 * The Bluetooth item on the bar: an icon for off, on or connected, named with
 * the connected devices. A click opens the {@link BluetoothPanel}.
 *
 * Draws nothing until BlueZ answers, on a D-Bus error, or with no adapter.
 */
export const Bluetooth = ({
  actions = BLUETOOTH_ACTIONS,
  bluetooth,
  domicile,
}: Props) => {
  const host = useMemo(() => system(domicile), [domicile]);
  return useSharedWatch(bluetooth)?.match({
    Err: () => undefined,
    Ok: (reading) =>
      reading.adapters.length === 0 ? undefined : (
        <Item actions={actions} host={host} reading={reading} />
      ),
  });
};

/** The button and its panel once BlueZ has reported an adapter. */
const Item = ({
  actions,
  host,
  reading,
}: {
  actions: BluetoothActions;
  host: System;
  reading: Reading;
}) => {
  const on = reading.adapters.some(({ powered }) => powered);
  const connected = reading.devices.filter((device) => device.connected);
  return (
    <Popover
      align="center"
      side="bottom"
      tone="overPhoto"
      trigger={
        <button
          aria-label={labelOf(
            on,
            connected.map(({ name }) => name),
          )}
          className={triggerStyles}
          type="button"
        >
          <Icon connected={connected.length > 0} on={on} />
        </button>
      }
      wide
    >
      <BluetoothPanel actions={actions} bluetooth={reading} host={host} />
    </Popover>
  );
};

const Icon = ({ connected, on }: { connected: boolean; on: boolean }) => {
  if (!on) {
    return <BluetoothSlashIcon size={15} weight="bold" />;
  } else if (connected) {
    return <BluetoothConnectedIcon size={15} weight="bold" />;
  } else {
    return <BluetoothIcon size={15} weight="bold" />;
  }
};

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. Matches the volume control.
const triggerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});

const labelOf = (on: boolean, names: string[]): string => {
  if (!on) {
    return "Bluetooth off";
  } else if (names.length === 0) {
    return "Bluetooth on";
  } else {
    return `Bluetooth: ${names.join(", ")}`;
  }
};
