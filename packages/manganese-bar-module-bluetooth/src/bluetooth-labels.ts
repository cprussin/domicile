import type { Device } from "@domicile-desktop/system-bluetooth/bluetooth";

/** Its name and tooltip: whether it is on, and each connected device's battery. */
export const labelOf = (on: boolean, connected: Device[]): string => {
  if (!on) {
    return "Bluetooth off";
  } else if (connected.length === 0) {
    return "Bluetooth on";
  } else {
    return `Bluetooth: ${connected.map(deviceLabelOf).join(", ")}`;
  }
};

const deviceLabelOf = ({ battery, name }: Device): string =>
  battery === undefined ? name : `${name} (${battery}%)`;

/** Why there is no adapter: still reading, off, or BlueZ failed. */
export const unavailableLabelOf = (
  reading: boolean,
  failure: string | undefined,
): string => {
  if (reading) {
    return "Reading Bluetooth";
  } else if (failure === undefined) {
    return "Bluetooth off";
  } else {
    return `Bluetooth unavailable: ${failure}`;
  }
};
