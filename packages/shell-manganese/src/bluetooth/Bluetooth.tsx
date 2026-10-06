import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type {
  Adapter,
  Bluetooth as Reading,
} from "@domicile-desktop/system-bluetooth/bluetooth";
import {
  setPowered,
  watchBluetooth,
} from "@domicile-desktop/system-bluetooth/bluetooth";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { BluetoothConnectedIcon } from "@phosphor-icons/react/dist/ssr/BluetoothConnected";
import { BluetoothSlashIcon } from "@phosphor-icons/react/dist/ssr/BluetoothSlash";
import { useEffect, useMemo, useState } from "react";

import { css } from "../../styled-system/css";

type Props = {
  /** The host whose system calls reach BlueZ. */
  domicile: DomicileHost;
  /** Injectable so tests can drive their own BlueZ. */
  watch?: typeof watchBluetooth | undefined;
  /** Injectable so tests can see what a click asks for. */
  power?: typeof setPowered | undefined;
};

/**
 * The Bluetooth toggle on the bar: an icon for off, on or connected, named
 * with the connected devices. A click turns every adapter off if any is on,
 * and on otherwise.
 *
 * Draws nothing until BlueZ answers, on a D-Bus error, or with no adapter.
 */
export const Bluetooth = ({
  domicile,
  power = setPowered,
  watch = watchBluetooth,
}: Props) => {
  const host = useMemo(() => system(domicile), [domicile]);
  const [bluetooth, setBluetooth] = useState<
    Result<Reading, SystemError> | undefined
  >(undefined);

  useEffect(() => watch(host, setBluetooth), [host, watch]);

  return bluetooth?.match({
    Err: () => undefined,
    Ok: (reading) =>
      reading.adapters.length === 0 ? undefined : (
        <Toggle host={host} power={power} reading={reading} />
      ),
  });
};

/** The button once BlueZ has reported an adapter. */
const Toggle = ({
  host,
  power,
  reading: { adapters, connected },
}: {
  host: System;
  power: typeof setPowered;
  reading: Reading;
}) => {
  const on = adapters.some(({ powered }) => powered);
  return (
    <button
      aria-label={labelOf(
        on,
        connected.map(({ name }) => name),
      )}
      className={triggerStyles}
      onClick={() => {
        toggle(host, power, adapters, !on);
      }}
      type="button"
    >
      <Icon connected={connected.length > 0} on={on} />
    </button>
  );
};

/** Turn every adapter on or off, logging BlueZ's refusals. */
const toggle = (
  host: System,
  power: typeof setPowered,
  adapters: readonly Adapter[],
  powered: boolean,
): void => {
  Promise.all(adapters.map(({ path }) => power(host, path, powered)))
    .then((results) => {
      for (const result of results) {
        result.match({
          Err: (error) => {
            // biome-ignore lint/suspicious/noConsole: the bar shows BlueZ's state, which did not change
            console.error(
              `Failed to turn Bluetooth ${powered ? "on" : "off"}`,
              error,
            );
          },
          Ok: () => {
            /* the watch reports the new state */
          },
        });
      }
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error("Failed to turn Bluetooth on or off", error);
    });
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
// unreadable over the wallpaper. Matches the brightness control.
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
