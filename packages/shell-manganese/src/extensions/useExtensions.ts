import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { extensionSchema } from "@domicile-desktop/sdk/extension";
import { useEffect, useState } from "react";
import { z } from "zod";

import { watchHost } from "../host/watch-host";

/**
 * The extensions with an action, as the engine last described them.
 *
 * The whole list, read off the host and again on every change — so, like
 * `useClipboard`, there is nothing to ask for. Read once for the whole desk
 * rather than once per bar.
 *
 * Parsed: the engine and this shell ship apart, and an action this shell
 * cannot draw should be a stack rather than a blank button.
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
