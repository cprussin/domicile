import type { PortalHost, PortalWallpaper } from "@domicile-desktop/sdk/portal";
import { watchPortalWallpaper } from "@domicile-desktop/sdk/portal";
import { useEffect, useState } from "react";

const NONE_SET: PortalWallpaper = {
  background: undefined,
  lockscreen: undefined,
};

/**
 * The pictures applications set through the Wallpaper portal, as paths. See
 * `docs/PORTALS.md`.
 */
export const usePortalWallpaper = (host: PortalHost): PortalWallpaper => {
  const [wallpaper, setWallpaper] = useState(NONE_SET);

  useEffect(() => watchPortalWallpaper(host, setWallpaper), [host]);

  return wallpaper;
};
