import type { AudioDevice } from "@domicile-desktop/system-audio/audio";

/**
 * The device the sliders control: the default, else the first device. The
 * server falls back the same way when its default is filtered out (a
 * monitor) or gone.
 */
export const primary = (
  devices: readonly AudioDevice[],
): AudioDevice | undefined =>
  devices.find((device) => device.default) ?? devices[0];
