import type {
  BoundShortcut,
  Capturing,
  PortalRequest,
  PortalWallpaper,
} from "@domicile-desktop/sdk/portal";

import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

// Each is `undefined` until the compositor's first push.

/** Every unanswered portal request, oldest first. */
export const usePortalRequests = (): readonly PortalRequest[] | undefined => {
  const { portals } = useDomicile();
  return useWatch(portals, "change", () => portals.requests);
};

/** Every session that controls or captures input. */
export const useCapturing = (): readonly Capturing[] | undefined => {
  const { portals } = useDomicile();
  return useWatch(portals, "change", () => portals.capturing);
};

/** Every chord applications hold through the GlobalShortcuts portal. */
export const useBoundShortcuts = (): readonly BoundShortcut[] | undefined => {
  const { portals } = useDomicile();
  return useWatch(portals, "change", () => portals.boundShortcuts);
};

/** The pictures applications set through the Wallpaper portal. */
export const usePortalWallpaper = (): PortalWallpaper | undefined => {
  const { portals } = useDomicile();
  return useWatch(portals, "change", () => portals.wallpaper);
};
