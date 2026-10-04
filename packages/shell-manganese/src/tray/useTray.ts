import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { useEffect, useState } from "react";

/**
 * The system tray's icons, as the compositor last described them.
 *
 * Like `useExtensions`: the full list is pushed on every change and on connect,
 * and the handler is registered once because `on` is a single slot.
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
