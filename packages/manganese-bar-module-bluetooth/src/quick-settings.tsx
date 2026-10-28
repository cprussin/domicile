import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import {
  deskBluetooth,
  deskBluetoothHardware,
} from "@domicile-desktop/system-bluetooth/react";
import { BluetoothPanel } from "./BluetoothPanel";
import { BluetoothGlyph, BluetoothTile } from "./BluetoothQuick";
import { BLUETOOTH_ACTIONS } from "./bluetooth-actions";

/** The desk's Bluetooth icon, for the quick settings button. */
export const BluetoothIndicator = () => (
  <BluetoothGlyph bluetooth={deskBluetooth(useDomicile())} />
);

/** The desk's Bluetooth tile, for the quick settings panel. Only the state while locked. */
export const BluetoothCard = ({
  onMore,
}: {
  onMore?: (() => void) | undefined;
}) => {
  const domicile = useDomicile();
  return (
    <BluetoothTile
      bluetooth={deskBluetooth(domicile)}
      hardware={deskBluetoothHardware(domicile)}
      locked={useBar().locked}
      onMore={onMore}
    />
  );
};

/** The desk's Bluetooth devices, for the quick settings panel's details. */
export const BluetoothDevices = () => {
  const domicile = useDomicile();
  const reading = useSharedWatch(deskBluetooth(domicile))?.match({
    Err: () => undefined,
    Ok: (found) => found,
  });
  return reading === undefined ? undefined : (
    <BluetoothPanel
      actions={BLUETOOTH_ACTIONS}
      bluetooth={reading}
      host={domicile}
    />
  );
};
