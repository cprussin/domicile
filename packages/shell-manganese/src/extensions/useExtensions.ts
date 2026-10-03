import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { useEffect, useState } from "react";

/**
 * The extensions with an action, as the engine last described them.
 *
 * Pushed, whole, on every change and once more to a page that has just
 * connected — so, like `useClipboard`, there is nothing to ask for. Registered
 * once for the whole desk rather than once per bar: `on` is a single slot, and
 * a desk drawn as several monitors on one page has a bar per monitor.
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
