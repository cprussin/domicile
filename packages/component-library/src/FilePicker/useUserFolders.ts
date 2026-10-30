import { useEffect, useState } from "react";

import type { Folders } from "./folders";
import type { UserPlace } from "./user-folders";

/**
 * The user's standard folders under `home`, for the sidebar: none until they
 * are found, and none if they cannot be.
 */
export const useUserFolders = (
  folders: Folders,
  home: string,
): readonly UserPlace[] => {
  const [found, setFound] = useState<Found>({ home, places: [] });

  useEffect(() => {
    let current = true;
    folders
      .userFolders(home)
      .then((places) => {
        if (current) {
          setFound({ home, places });
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the sidebar still offers the home and the computer
        console.error(
          "The file picker could not find the user's folders",
          error,
        );
      });
    return () => {
      current = false;
    };
  }, [folders, home]);

  return found.home === home ? found.places : [];
};

/** The folders found, and the home they were found for. */
type Found = { home: string; places: readonly UserPlace[] };
