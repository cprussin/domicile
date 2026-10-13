// The cameras and microphones a browser window's page can be given, through
// the `<webview>`.
//
// The engine keeps the preference, which is the profile's rather than the
// site's; this module only parses what it reports.

import type { WebViewMediaDeviceKind } from "@domicile-desktop/sdk/webview-element";
import { z } from "zod";

/** A camera or microphone. */
export type MediaDevice = z.infer<typeof deviceSchema>;

/**
 * Each kind's devices, most preferred first. A page that names no device gets
 * the first.
 */
export type MediaDevices = z.infer<typeof devicesSchema>;

/** Lists the devices, and picks the one a page that names none gets. */
export type MediaDeviceChoice = {
  list: () => Promise<MediaDevices>;
  prefer: (kind: WebViewMediaDeviceKind, id: string) => Promise<void>;
};

/** Parses `view.mediaDevices()`'s answer. Throws for anything else. */
export const mediaDevicesOf = (reported: unknown): MediaDevices =>
  devicesSchema.parse(reported);

/**
 * `view`'s devices, or nothing from an engine without them, as
 * `useSitePermissions` allows for an engine without site permissions.
 */
export const mediaDeviceChoiceFor = (
  view: HTMLWebViewElement,
): MediaDeviceChoice | undefined =>
  "mediaDevices" in view
    ? {
        list: () => view.mediaDevices().then(mediaDevicesOf),
        prefer: (kind, id) => view.setMediaDevice(kind, id),
      }
    : undefined;

const deviceSchema = z.object({ id: z.string(), name: z.string() });

const devicesSchema = z.object({
  cameras: z.array(deviceSchema),
  microphones: z.array(deviceSchema),
});
