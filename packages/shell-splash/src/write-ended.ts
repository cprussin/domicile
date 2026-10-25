// Tells `domicile` the splash is ready to give way, by writing the file it
// waits for (`domicile_launch::splash::ENDED`).

import type { Files } from "@domicile-desktop/sdk/desktop/files";

/** Writes the empty file `path`. Rejects with the compositor's refusal. */
export const writeEnded = async (
  { files }: { readonly files: Pick<Files, "write"> },
  path: string,
): Promise<void> => {
  const written = await files.write(path, "");
  written.match({
    Err: (error) => {
      throw new Error(`could not write ${path}`, { cause: error });
    },
    Ok: () => undefined,
  });
};
