import type { FileRequest } from "@domicile-desktop/component-library/file-request";
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useRef, useState } from "react";
import { fileRequestOf } from "./file-request";

/**
 * A pending request with a serial number, so each new request remounts the
 * picker instead of keeping the last one's input.
 */
export type HeldRequest = FileRequest & { serial: number };

/**
 * The file request the page in `view` is waiting on, if any, listing
 * directories with `list`.
 *
 * `preventDefault()` claims the request; the engine cancels unclaimed ones
 * when dispatch returns (see `WEBVIEW_FILE_CHOOSER_EVENT`). An unknown mode
 * throws before claiming, so the engine cancels it.
 *
 * Only the newest request is kept: a new one cancels the previous one, and
 * unmounting cancels any open one so the page does not wait forever.
 * Answering the request clears it.
 *
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const useFileRequest = (
  view: HTMLElement | null,
  list: FileRequest["list"],
): HeldRequest | undefined => {
  const [asking, setAsking] = useState<HeldRequest | undefined>(undefined);
  // The pending request, in a ref because two can arrive before a render.
  // State drives rendering; this is what gets canceled.
  const outstanding = useRef<HeldRequest | undefined>(undefined);
  const asked = useRef(0);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const took = (event: DomicileFileChooserEvent) => {
        const request = fileRequestOf(event, list);
        event.preventDefault();
        outstanding.current?.cancel();
        asked.current += 1;
        const settled = () => {
          if (outstanding.current === held) {
            outstanding.current = undefined;
            setAsking(undefined);
          }
        };
        const held: HeldRequest = {
          ...request,
          cancel: () => {
            settled();
            request.cancel();
          },
          choose: (paths) => {
            settled();
            request.choose(paths);
          },
          serial: asked.current,
        };
        outstanding.current = held;
        setAsking(held);
      };
      view.addEventListener(WEBVIEW_FILE_CHOOSER_EVENT, took);
      return () => {
        view.removeEventListener(WEBVIEW_FILE_CHOOSER_EVENT, took);
        outstanding.current?.cancel();
      };
    }
  }, [view, list]);

  return asking;
};
