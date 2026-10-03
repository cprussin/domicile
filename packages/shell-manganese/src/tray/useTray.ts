import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { TrayItem } from "@domicile/sdk/tray";
import { useEffect, useState } from "react";

/**
 * The system tray's icons, as the compositor last described them.
 *
 * `useExtensions`' shape and for its reasons: pushed, whole, on every change
 * and once more to a page that has just connected, and registered once for the
 * whole desk because `on` is a single slot.
 */
export const useTray = (domicile: DomicileClient): readonly TrayItem[] => {
  const [items, setItems] = useState<readonly TrayItem[]>([]);

  useEffect(() => {
    domicile.on("tray", (message) => {
      setItems(message.items);
    });
  }, [domicile]);

  return items;
};
