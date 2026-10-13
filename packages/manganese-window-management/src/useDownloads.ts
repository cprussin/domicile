import { WEBVIEW_DOWNLOADS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import type { Downloads } from "./browser/downloads";

const NONE: Downloads = {
  completed: 0,
  count: 0,
  receivedBytes: 0,
  totalBytes: 0,
};

/**
 * A `<webview>`'s page's downloads: those in progress, and how many finished.
 *
 * Reads the properties on mount and on each event, like `useLoadProgress`.
 * Takes `null` because the element comes from a callback ref.
 */
export const useDownloads = (view: HTMLWebViewElement | null): Downloads => {
  const [downloads, setDownloads] = useState(NONE);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setDownloads({
          completed: view.downloadCompletedCount,
          count: view.downloadCount,
          receivedBytes: view.downloadReceivedBytes,
          totalBytes: view.downloadTotalBytes,
        });
      };
      read();
      view.addEventListener(WEBVIEW_DOWNLOADS_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_DOWNLOADS_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return downloads;
};
