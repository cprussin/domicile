// Tells `domicile` the splash is ready to give way, by writing the file it
// waits for (`domicile_launch::splash::ENDED`).

import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";

/** Writes the empty file `path`. Rejects with the compositor's refusal. */
export const writeEnded = async (
  domicile: DomicileHost,
  path: string,
  files: (domicile: DomicileHost) => Pick<System, "writeFile"> = system,
): Promise<void> => {
  const written = await files(domicile).writeFile(path, "");
  written.match({
    Err: (error) => {
      throw new Error(`could not write ${path}`, { cause: error });
    },
    Ok: () => undefined,
  });
};
