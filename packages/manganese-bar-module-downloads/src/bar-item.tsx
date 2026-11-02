import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useWatch } from "@domicile-desktop/react/use-watch";
import { opens } from "@domicile-desktop/system-apps/opens";
import { DownloadsItem, OpenResult } from "./DownloadsItem";

/**
 * The desk's downloads, from every browser and app window: shown while there
 * are any, with how far the ones in progress have come. The engine lists them.
 * Its panel opens by itself, on the screen with the keyboard, as one starts.
 */
export const Downloads = () => {
  const domicile = useDomicile();
  const { popsUp } = useBar();
  const downloads = useWatch(
    domicile.downloads,
    "change",
    () => domicile.downloads.list,
  );
  return (
    <DownloadsItem
      downloads={downloads}
      onCancel={domicile.downloads.cancel}
      onClear={domicile.downloads.clear}
      onOpen={async (path) =>
        (await opens(domicile, path)).match({
          Err: (error) => {
            throw new Error(`Cannot tell what opens ${path}`, {
              cause: error,
            });
          },
          Ok: (opened) => {
            if (opened) {
              domicile.processes.launch(["xdg-open", path]);
              return OpenResult.Opened;
            } else {
              return OpenResult.NoApp;
            }
          },
        })
      }
      onRemove={domicile.downloads.remove}
      onShowInFolder={(path) => {
        domicile.processes.launch([
          "xdg-open",
          path.slice(0, path.lastIndexOf("/")),
        ]);
      }}
      popsUp={popsUp}
    />
  );
};
