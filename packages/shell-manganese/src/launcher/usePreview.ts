import type { FilePreview } from "@domicile-desktop/sdk/file-preview";
import { useEffect, useState } from "react";

import { superseded } from "../host/superseded";

/**
 * The host's preview of `path`, or `undefined` until it answers.
 *
 * Answers for a stale path are dropped, since they can arrive out of order.
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

  // Keyed on the path, so the previous row's preview isn't shown while the
  // new one loads.
  return shown?.path === path ? shown.preview : undefined;
};
