import type { Devices } from "@domicile-desktop/sdk/portal";

/** The names of the devices set in `devices`, in a fixed order. */
export const deviceNames = (devices: Devices): (keyof Devices)[] =>
  DEVICES.filter((device) => devices[device]);

const DEVICES = ["keyboard", "pointer", "touchscreen"] as const;
