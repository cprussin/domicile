import type { Result } from "@cprussin/option-result";
import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import { isAbsent } from "@domicile-desktop/react/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Bluetooth as Reading } from "@domicile-desktop/system-bluetooth/bluetooth";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { BluetoothConnectedIcon } from "@phosphor-icons/react/dist/ssr/BluetoothConnected";
import { BluetoothSlashIcon } from "@phosphor-icons/react/dist/ssr/BluetoothSlash";

import { cva } from "../styled-system/css";
import { labelOf, unavailableLabelOf } from "./bluetooth-labels";

type GlyphProps = {
  /** The desk's Bluetooth, from BlueZ. */
  bluetooth: SharedWatch<Result<Reading, SystemError>>;
};

/**
 * The Bluetooth icon in the quick settings button, shown only while a device
 * is connected, or in `warning` when BlueZ fails.
 */
export const BluetoothGlyph = ({ bluetooth }: GlyphProps) => {
  const reading = useSharedWatch(bluetooth);
  return reading?.match({
    Err: (error) => (
      <span
        aria-label={unavailableLabelOf(false, error.message)}
        className={glyphStyles({ failed: true })}
        role="img"
      >
        <BluetoothSlashIcon size={15} weight="bold" />
      </span>
    ),
    Ok: (found) => {
      const connected = found.devices.filter((device) => device.connected);
      return connected.length === 0 ? undefined : (
        <span
          aria-label={labelOf(true, connected)}
          className={glyphStyles({ failed: false })}
          role="img"
        >
          <BluetoothConnectedIcon size={15} weight="bold" />
        </span>
      );
    },
  });
};

type TileProps = GlyphProps & {
  /** Whether the machine has Bluetooth hardware, from `/sys`. */
  hardware: SharedWatch<Result<boolean, SystemError>>;
  /** A locked desktop has no details, so the tile only shows the state. */
  locked?: boolean | undefined;
  /** Opens the devices panel, which has the power switch. */
  onMore?: (() => void) | undefined;
};

/**
 * The quick settings tile that opens the devices, naming the connected ones.
 * Bluetooth is nearly always on, so the tile is a way in, not a switch.
 * Nothing until BlueZ answers, and nothing without Bluetooth hardware.
 * Without an adapter it says why and can't be pressed.
 */
export const BluetoothTile = ({
  bluetooth,
  hardware,
  locked = false,
  onMore,
}: TileProps) => {
  const reading = useSharedWatch(bluetooth);
  const present = useSharedWatch(hardware);
  const usable = reading?.match({
    Err: () => undefined,
    Ok: (found) => (found.adapters.length > 0 ? found : undefined),
  });
  if (usable !== undefined) {
    const on = usable.adapters.some(({ powered }) => powered);
    const connected = usable.devices.filter((device) => device.connected);
    return (
      <QuickTile
        detail={detailOf(
          connected.map(({ name }) => name),
          on,
        )}
        icon={<BluetoothIcon size={15} weight="bold" />}
        label="Bluetooth"
        onMore={locked ? undefined : onMore}
      />
    );
  } else if (reading === undefined || isAbsent(present)) {
    return undefined;
  } else {
    return (
      <QuickTile
        detail={reading.match({
          Err: () => "Unavailable",
          Ok: () => "Off",
        })}
        icon={<BluetoothSlashIcon size={15} weight="bold" />}
        label="Bluetooth"
      />
    );
  }
};

/** The tile's second line: the connected devices, or whether it is on. */
const detailOf = (connected: readonly string[], on: boolean): string => {
  if (connected.length > 0) {
    return connected.join(", ");
  } else {
    return on ? "Not connected" : "Off";
  }
};

const glyphStyles = cva({
  base: { display: "inline-flex", flexShrink: 0 },
  variants: {
    failed: {
      false: {},
      true: { color: "warning" },
    },
  },
});
