import { WEBVIEW_PAGE_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useState } from "react";

import {
  ConnectionSafety,
  connectionSafety,
} from "../address/connection-safety";

/** The page a `<webview>` is showing, as its chrome needs it. */
type ShownPage = {
  /**
   * What the browser says about the connection behind it.
   *
   * READ IT WITH {@link ShownPage.url} AND NEVER APART FROM IT. They are set
   * from one message about one entry, so a lock drawn from this describes the
   * address beside it. Pairing this with an address from somewhere else — the
   * one the shell *sent* the window to, say — is how a padlock comes to be
   * drawn next to a page it does not belong to.
   */
  security: ConnectionSafety;
  /**
   * Where the page actually is, or `""` before the browser has said.
   *
   * Not where the shell sent it: a link followed, a redirect taken and a form
   * posted all move this and none of them is a navigation the shell made.
   */
  url: string;
  /** Every page it has shown, oldest first, for the address bar to suggest from. */
  visited: readonly string[];
};

/** A view that has shown nothing, which is what a window with no view has too. */
const NOTHING: ShownPage = {
  security: ConnectionSafety.Unstated,
  url: "",
  visited: [],
};

/**
 * The page inside a `<webview>` — where it is, what the browser says about the
 * connection under it, and everywhere it has been — kept current.
 *
 * **The element is the state and the event is only a nudge**, the same way
 * `useLoading` and `useHistoryAvailability` are: `domicile-page-change` carries
 * nothing, and what changed is readable on the element. This reads it once as
 * it mounts and again every time the view says so. The mount read matters more
 * here than anywhere else in this shell — a chrome that learned the security
 * level only from events would have none for the page that was already showing
 * when it mounted, and the one thing a browser window must not do is draw a
 * padlock it was never given.
 *
 * WHERE THE WINDOW HAS BEEN IS NOW WHERE IT WENT, which is the whole of what
 * this replaced: the shell used to keep the addresses it had *sent* a window
 * to, because that was all it could see. It sees the page now.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
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
            // Parsed rather than trusted: this is an engine's value reaching a
            // page, so it is external data — see `connection-safety.ts`.
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
 * `visited` with `url` on the end, unless it is already there.
 *
 * THE SAME PAGE TWICE IN A ROW IS ONE VISIT. A page's security can change
 * without the page changing — a subresource with a bad certificate arriving
 * after the commit is exactly that, and it is the case the whole security
 * report exists for — so a list that grew per message would fill with one
 * address. An empty url is not a visit either: it is a guest that has shown
 * nothing yet.
 */
const visitedAfter = (
  visited: readonly string[],
  url: string,
): readonly string[] =>
  url === "" || visited.at(-1) === url ? visited : [...visited, url];
