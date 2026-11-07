import type { WebViewPromptKind } from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_PROMPT_EVENT,
  WEBVIEW_PROMPT_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * A question the browser would ask with a dialog of its own, waiting on the
 * user: file access, a certificate, Bluetooth pairing or an extension's
 * permissions.
 */
export type PromptRequest = {
  /** What is asked. */
  kind: WebViewPromptKind;
  /** The site that asked, such as `https://vscode.dev`, or `""`. */
  origin: string;
  /** A file's, device's or extension's name; `""` for the others. */
  subject: string;
  /** A file's full path, the certificates, or an extension's permissions. */
  details: readonly string[];
  /** The PIN a Bluetooth device shows, or `""`. */
  pin: string;
  /** Answer yes, with the picked entry of `details` and the typed text. */
  accept: (choice?: number, text?: string) => void;
  /** Answer no. */
  dismiss: () => void;
};

/**
 * The prompt the page in `view` is waiting on, if any.
 *
 * `preventDefault()` claims it; the engine answers unclaimed ones no when
 * dispatch returns (see `WEBVIEW_PROMPT_EVENT`). Answering clears it, as does
 * the engine withdrawing it. Unmounting answers nothing: the engine answers no
 * for a request whose element is gone.
 *
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const usePromptRequest = (
  view: HTMLElement | null,
): PromptRequest | undefined => {
  const [request, setRequest] = useState<PromptRequest | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const cleared = () => {
        setRequest(undefined);
      };
      const asked = (event: DomicilePromptEvent) => {
        event.preventDefault();
        setRequest({
          accept: (choice, text) => {
            cleared();
            event.accept(choice, text);
          },
          details: event.details,
          dismiss: () => {
            cleared();
            event.dismiss();
          },
          kind: event.kind,
          origin: event.origin,
          pin: event.pin,
          subject: event.subject,
        });
      };
      view.addEventListener(WEBVIEW_PROMPT_EVENT, asked);
      view.addEventListener(WEBVIEW_PROMPT_WITHDRAWN_EVENT, cleared);
      return () => {
        view.removeEventListener(WEBVIEW_PROMPT_EVENT, asked);
        view.removeEventListener(WEBVIEW_PROMPT_WITHDRAWN_EVENT, cleared);
      };
    }
  }, [view]);

  return request;
};
