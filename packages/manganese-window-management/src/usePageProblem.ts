import type {
  WebViewPageFailure,
  WebViewRenderProcessGone,
} from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_PAGE_FAILURE_CHANGE_EVENT,
  WEBVIEW_RENDER_PROCESS_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * Why a browser window's page shows nothing: it failed to load, or its
 * renderer went away. The engine draws no error, warning or crash page, so
 * the shell draws one.
 */
export type PageProblem =
  | {
      kind: WebViewPageFailure;
      /** The address that failed. */
      url: string;
      /** Chromium's name for the error, such as `ERR_NAME_NOT_RESOLVED`. */
      error: string;
      /** The HTTP status for `http`; otherwise 0. */
      httpStatus: number;
      /** Whether `proceedPastWarning()` loads it anyway. */
      canProceed: boolean;
    }
  | { kind: "gone"; reason: WebViewRenderProcessGone };

/**
 * The problem the page in `view` has, if any. A crash wins over a failure:
 * the failed page's renderer is gone too.
 *
 * The events carry no data, so this reads the element on mount and on each.
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const usePageProblem = (
  view: HTMLWebViewElement | null,
): PageProblem | undefined => {
  const [problem, setProblem] = useState<PageProblem | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      setProblem(undefined);
      return undefined;
    } else {
      const read = () => {
        setProblem(problemOf(view));
      };
      read();
      view.addEventListener(WEBVIEW_PAGE_FAILURE_CHANGE_EVENT, read);
      view.addEventListener(WEBVIEW_RENDER_PROCESS_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_PAGE_FAILURE_CHANGE_EVENT, read);
        view.removeEventListener(WEBVIEW_RENDER_PROCESS_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return problem;
};

const problemOf = (view: HTMLWebViewElement): PageProblem | undefined => {
  // Read through `?? ""`: an engine without these leaves them undefined.
  const gone = view.renderProcessGone ?? "";
  const failure = view.pageFailure ?? "";
  if (gone !== "") {
    return { kind: "gone", reason: gone };
  } else if (failure === "") {
    return undefined;
  } else {
    return {
      canProceed: view.pageFailureCanProceed,
      error: view.pageFailureError,
      httpStatus: view.pageFailureHttpStatus,
      kind: failure,
      url: view.pageFailureUrl,
    };
  }
};
