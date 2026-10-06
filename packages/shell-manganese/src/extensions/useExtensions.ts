import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { extensionSchema } from "@domicile-desktop/sdk/extension";
import { useEffect, useState } from "react";
import { z } from "zod";

import { watchHost } from "../host/watch-host";

/**
 * The extensions with an action, as the engine last reported them.
 *
 * Reads the full list from the host, once per page rather than per bar, and
 * again on every change.
 *
 * Parsed because the engine and this shell ship separately; an action this
 * shell cannot draw should throw, not draw a blank button.
 */
export const useExtensions = (domicile: DomicileHost): readonly Extension[] => {
  const [extensions, setExtensions] = useState<readonly Extension[]>([]);

  useEffect(
    () => watchHost(domicile, "extensionschanged", extensionsOf, setExtensions),
    [domicile],
  );

  return extensions;
};

const extensionsOf = ({
  extensions,
}: DomicileHost): readonly Extension[] | undefined =>
  extensions === null ? undefined : z.array(extensionSchema).parse(extensions);
