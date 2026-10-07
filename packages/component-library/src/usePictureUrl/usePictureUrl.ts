import type { System } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

type Files = Pick<System, "readFile">;

/**
 * A URL an `<img>` can show for the picture at `path`, read through the SDK's
 * `system`. `undefined` for no path, until it is read, or when it cannot be
 * read (logged). The URL is revoked when the path changes or on unmount.
 */
export const usePictureUrl = (
  files: Files,
  path: string | undefined,
): string | undefined => {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(
    () => (path === undefined ? undefined : showPicture(files, path, setUrl)),
    [files, path],
  );

  return url;
};

/** Read `path` and hand `show` its URL. Returns what undoes it. */
const showPicture = (
  files: Files,
  path: string,
  show: (url: string | undefined) => void,
): (() => void) => {
  // Set once read; `current` drops a read that finishes after the undo.
  let made: string | undefined;
  let current = true;
  files
    .readFile(path)
    .then((read) => {
      read.match({
        Err: (error) => {
          // biome-ignore lint/suspicious/noConsole: the picture stays unshown; say why
          console.error(`cannot read the picture ${path}`, error);
        },
        Ok: (bytes) => {
          if (current) {
            made = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
            show(made);
          }
        },
      });
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: the picture stays unshown; say why
      console.error(`cannot read the picture ${path}`, error);
    });
  return () => {
    current = false;
    show(undefined);
    if (made !== undefined) {
      URL.revokeObjectURL(made);
    }
  };
};
