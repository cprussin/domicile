import type { WebViewDialogType } from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_DIALOG_EVENT,
  WEBVIEW_DIALOG_TYPES,
  WEBVIEW_DIALOG_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";
import { z } from "zod";

/** An `alert()`, `confirm()` or `prompt()` the page is paused on. */
export type DialogRequest = {
  type: WebViewDialogType;
  /** The calling frame's origin, or `null` for one with no site. */
  origin: string;
  message: string;
  /** `prompt()`'s initial text. */
  defaultValue: string;
  /** OK, with `prompt()`'s text. */
  accept: (value?: string) => void;
  /** Cancel. */
  dismiss: () => void;
};

/**
 * The dialog the page in `view` is paused on, if any.
 *
 * `preventDefault()` claims it; the engine dismisses unclaimed ones when
 * dispatch returns (see `WEBVIEW_DIALOG_EVENT`). A dialog type this shell
 * cannot show throws before claiming, so the engine dismisses it.
 *
 * The engine sends one at a time. Answering clears it, as does the engine
 * withdrawing it. Unmounting answers nothing: the engine dismisses a dialog
 * whose element is gone.
 *
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const useDialogRequest = (
  view: HTMLElement | null,
): DialogRequest | undefined => {
  const [request, setRequest] = useState<DialogRequest | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const cleared = () => {
        setRequest(undefined);
      };
      const opened = (event: DomicileDialogEvent) => {
        const type = dialogTypeSchema.parse(event.dialogType);
        event.preventDefault();
        setRequest({
          accept: (value) => {
            cleared();
            event.accept(value);
          },
          defaultValue: event.defaultValue,
          dismiss: () => {
            cleared();
            event.dismiss();
          },
          message: event.message,
          origin: event.origin,
          type,
        });
      };
      view.addEventListener(WEBVIEW_DIALOG_EVENT, opened);
      view.addEventListener(WEBVIEW_DIALOG_WITHDRAWN_EVENT, cleared);
      return () => {
        view.removeEventListener(WEBVIEW_DIALOG_EVENT, opened);
        view.removeEventListener(WEBVIEW_DIALOG_WITHDRAWN_EVENT, cleared);
      };
    }
  }, [view]);

  return request;
};

const dialogTypeSchema = z.enum(WEBVIEW_DIALOG_TYPES);
