import type { FilePreview } from "@domicile/chrome-sdk/file-preview";
import type { FilePreviewMessage } from "@domicile/chrome-sdk/host-message";
import { useEffect, useState } from "react";

/**
 * What the host says `path` holds, asked whenever it changes, and `undefined`
 * until it has answered.
 *
 * An answer for a path the highlight has already left is dropped: an arrow
 * key is faster than a disk, and the host owes the answers no order.
 */
export const usePreview = (
  preview: (path: string) => Promise<FilePreviewMessage>,
  path: string,
): FilePreview | undefined => {
  const [shown, setShown] = useState<FilePreviewMessage | undefined>(undefined);

  useEffect(() => {
    let current = true;
    preview(path)
      .then((answer) => {
        if (current) {
          setShown(answer);
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a preview the host failed
        console.error("The host could not preview a file", error);
      });
    return () => {
      current = false;
    };
  }, [preview, path]);

  // Keyed on the path as well as dropped on it, so the row just left is not
  // drawn under the one just reached while its own answer is on the way.
  return shown?.path === path ? shown.preview : undefined;
};
