import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useRef, useState } from "react";

import type { FileRequest } from "./file-request";
import { fileRequestOf } from "./file-request";

/**
 * A question this window is holding, with which one it is: a count of every
 * question the view has asked, so a picker drawn for the next one is drawn
 * afresh rather than carrying the last one's typing over.
 */
export type HeldRequest = FileRequest & { serial: number };

/**
 * The file the page in `view` is waiting on, or `undefined` while it is
 * waiting on none.
 *
 * **TAKEN, OR REFUSED FOR US.** The engine cancels a question nobody takes as
 * soon as its dispatch returns, so the `preventDefault()` here is this window
 * saying it will draw the picker — see `WEBVIEW_FILE_CHOOSER_EVENT`. One whose
 * mode this shell cannot read is not taken: the parse throws first, and the
 * engine refuses it rather than a picker answering the wrong question.
 *
 * **ONE AT A TIME, THE NEWEST.** A page can only be waiting on the picker it
 * can see, and the question that just arrived is the one the user just caused
 * — so the one it replaces is canceled rather than queued behind it. And a
 * window that goes with a question open cancels it: a page left waiting on a
 * picker nobody can reach waits for good.
 *
 * Answering the request this returns puts it away, which is what takes the
 * picker off the page.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref.
 */
export const useFileRequest = (
  view: HTMLElement | null,
): HeldRequest | undefined => {
  const [asking, setAsking] = useState<HeldRequest | undefined>(undefined);
  // The question the engine is still waiting on, which the listener has to
  // read at the moment the next one arrives — two can land before a render.
  // State is what draws it; this is what answers it.
  const outstanding = useRef<HeldRequest | undefined>(undefined);
  const asked = useRef(0);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const took = (event: DomicileFileChooserEvent) => {
        const request = fileRequestOf(event);
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
  }, [view]);

  return asking;
};
