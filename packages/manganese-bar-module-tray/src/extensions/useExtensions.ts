import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { useEffect, useState } from "react";

/**
 * The extensions with an action, as the engine last reported them.
 *
 * Reads the full list from the host, once per page rather than per bar, and
 * again on every change.
 *
 * Parsed because the engine and this shell ship separately; an action this
 * shell cannot draw should throw, not draw a blank button.
 */
export const useExtensions = (
  domicile: Pick<Domicile, "extensions">,
): readonly Extension[] => {
  const [extensions, setExtensions] = useState<readonly Extension[]>([]);

  useEffect(() => {
    const { extensions: desk } = domicile;
    return watchHost(
      (changed) => desk.on("change", changed),
      () => desk.list,
      setExtensions,
    );
  }, [domicile]);

  return extensions;
};
