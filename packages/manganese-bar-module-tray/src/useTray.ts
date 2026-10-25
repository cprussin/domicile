import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { useEffect, useState } from "react";

/**
 * The system tray's icons, as the compositor last described them.
 *
 * Like `useExtensions`: reads the full list from the host once for the whole
 * desktop, and again on every change.
 */
export const useTray = (
  domicile: Pick<Domicile, "tray">,
): readonly TrayItem[] => {
  const [items, setItems] = useState<readonly TrayItem[]>([]);

  useEffect(() => {
    const { tray } = domicile;
    return watchHost(
      (changed) => tray.on("change", changed),
      () => tray.items,
      setItems,
    );
  }, [domicile]);

  return items;
};
