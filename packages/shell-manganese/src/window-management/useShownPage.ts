import { WEBVIEW_PAGE_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import {
  ConnectionSafety,
  connectionSafety,
} from "../address/connection-safety";

/** The page a `<webview>` is showing, for its chrome. */
type ShownPage = {
  /**
   * The connection security the browser reports for the page.
   *
   * Always pair it with {@link ShownPage.url}: both come from one message about
   * one entry. Pairing it with another address could draw a padlock beside the
   * wrong page.
   */
  security: ConnectionSafety;
  /**
   * The page's current address, or `""` before the browser reports one.
   *
   * Includes navigations the shell did not start, such as links, redirects and
   * form posts.
   */
  url: string;
  /** Every address shown, oldest first, for address bar suggestions. */
  visited: readonly string[];
};

/** The state before a view has shown anything, or when there is no view. */
const NOTHING: ShownPage = {
  security: ConnectionSafety.Unstated,
  url: "",
  visited: [],
};

/**
 * The address, connection security and visited addresses of a `<webview>`.
 *
 * `domicile-page-change` carries no data, so this reads the element on mount
 * and on each event. The mount read ensures the page already showing gets a
 * security level; without it the chrome would have none to draw.
 *
 * Takes `null` because the element comes from a callback ref.
 */
export const useShownPage = (view: HTMLWebViewElement | null): ShownPage => {
  const [page, setPage] = useState(NOTHING);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setPage((shown) => {
          const url = view.url ?? "";
          return {
            // Parsed because it is external data (see `connection-safety.ts`).
            security: connectionSafety(view.security),
            url,
            visited: visitedAfter(shown.visited, url),
          };
        });
      };
      read();
      view.addEventListener(WEBVIEW_PAGE_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_PAGE_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return page;
};

/**
 * `visited` with `url` appended, unless it is empty or already last.
 *
 * A security change without navigation (such as a late subresource with a bad
 * certificate) sends another message for the same address.
 */
const visitedAfter = (
  visited: readonly string[],
  url: string,
): readonly string[] =>
  url === "" || visited.at(-1) === url ? visited : [...visited, url];
