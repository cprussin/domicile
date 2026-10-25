import type { Portals } from "@domicile-desktop/sdk/desktop/portals";
import type { PortalWallpaper } from "@domicile-desktop/sdk/portal";
import { useCallback, useSyncExternalStore } from "react";

const NONE_SET: PortalWallpaper = {
  background: undefined,
  lockscreen: undefined,
};

/** What {@link usePortalWallpaper} reads. */
export type WallpaperDesktop = {
  readonly portals: Pick<Portals, "on" | "wallpaper">;
};

/**
 * The pictures applications set through the Wallpaper portal, as paths. See
 * `docs/PORTALS.md`.
 */
export const usePortalWallpaper = ({
  portals,
}: WallpaperDesktop): PortalWallpaper => {
  const subscribe = useCallback(
    (changed: () => void) => portals.on("change", changed),
    [portals],
  );
  return useSyncExternalStore(subscribe, () => portals.wallpaper ?? NONE_SET);
};
