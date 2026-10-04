import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { useEffect, useState } from "react";

/**
 * The extensions with an action, as the engine last reported them.
 *
 * The engine pushes the full list on every change and on connect. Registered
 * once per page, not per bar, because `on` holds one handler and a page can
 * draw a bar per monitor.
 */
export const useExtensions = (
  domicile: DomicileClient,
): readonly Extension[] => {
  const [extensions, setExtensions] = useState<readonly Extension[]>([]);

  useEffect(() => {
    domicile.on("extensions", (message) => {
      setExtensions(message.extensions);
    });
  }, [domicile]);

  return extensions;
};
