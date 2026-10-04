import type { FilePreview } from "@domicile-desktop/sdk/file-preview";
import { useEffect, useState } from "react";

import { superseded } from "../host/superseded";

/**
 * What the host says `path` holds, asked whenever it changes, and `undefined`
 * until it has answered.
 *
 * An answer for a path the highlight has already left is dropped: an arrow
 * key is faster than a disk, and the host owes the answers no order.
 */
export const usePreview = (
  preview: (path: string) => Promise<FilePreview>,
  path: string,
): FilePreview | undefined => {
  const [shown, setShown] = useState<
    { path: string; preview: FilePreview } | undefined
  >(undefined);

  useEffect(() => {
    let current = true;
    preview(path)
      .then((answer) => {
        if (current) {
          setShown({ path, preview: answer });
        }
      })
      .catch((error: unknown) => {
        // A newer preview replaced this one: the highlight has moved on.
        if (!superseded(error)) {
          // biome-ignore lint/suspicious/noConsole: surfacing a preview the host failed
          console.error("The host could not preview a file", error);
        }
      });
    return () => {
      current = false;
    };
  }, [preview, path]);

  // Keyed on the path as well as dropped on it, so the row just left is not
  // drawn under the one just reached while its own answer is on the way.
  return shown?.path === path ? shown.preview : undefined;
};
