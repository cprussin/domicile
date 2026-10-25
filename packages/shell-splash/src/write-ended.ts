// Tells `domicile` the splash is ready to give way, by writing the file it
// waits for (`domicile_launch::splash::ENDED`).

import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

/** Writes the empty file `path`. Rejects with the compositor's refusal. */
export const writeEnded = async (
  domicile: DomicileHost,
  path: string,
  files: (domicile: DomicileHost) => Pick<Files, "write"> = (host) =>
    desktop(host).files,
): Promise<void> => {
  const written = await files(domicile).write(path, "");
  written.match({
    Err: (error) => {
      throw new Error(`could not write ${path}`, { cause: error });
    },
    Ok: () => undefined,
  });
};
