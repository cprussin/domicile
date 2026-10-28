/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import { Loading } from "@domicile-desktop/component-library/Loading";
import { PermissionAsk } from "@domicile-desktop/manganese-page-requests/PermissionAsk";
import { usePermissionRequest } from "@domicile-desktop/manganese-page-requests/usePermissionRequest";
import {
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import type { Inbox, InboxKind } from "./inbox";

type Props = {
  inbox: Extract<Inbox, { kind: InboxKind.Page }>;
  /** Whether the drawer shows it. */
  shown: boolean;
  /** The page asked to be shown, as on a press of its notification. */
  onShow: () => void;
  /** The page's count of unread conversations. */
  onUnread: (unread: number) => void;
};

/**
 * An inbox's page, with its permission requests asked above it. Kept mounted
 * while hidden, so its notifications keep coming and its count stays current.
 */
export const InboxPage = ({ inbox, onShow, onUnread, shown }: Props) => {
  // `null` because React passes it to a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  const request = usePermissionRequest(view);
  // Loading from the start: the page is asked for as the view mounts.
  const [loading, setLoading] = useState(true);
  const { countUnread, url } = inbox;

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      view.addEventListener(WEBVIEW_FOCUS_REQUEST_EVENT, onShow);
      return () => {
        view.removeEventListener(WEBVIEW_FOCUS_REQUEST_EVENT, onShow);
      };
    }
  }, [onShow, view]);

  useEffect(
    () => (view === null ? undefined : countUnread(view, onUnread)),
    [countUnread, onUnread, view],
  );

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const changed = () => {
        setLoading(view.loading);
      };
      view.addEventListener(WEBVIEW_LOADING_CHANGE_EVENT, changed);
      return () => {
        view.removeEventListener(WEBVIEW_LOADING_CHANGE_EVENT, changed);
      };
    }
  }, [view]);

  // A page loaded before the network was up stays offline until reloaded,
  // and the drawer has no reload button.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const reload = () => {
        view.reload();
      };
      globalThis.addEventListener("online", reload);
      return () => {
        globalThis.removeEventListener("online", reload);
      };
    }
  }, [view]);

  return (
    <div className={pageStyles} hidden={!shown}>
      {request !== undefined && (
        <div className={askStyles}>
          <PermissionAsk
            asker={new URL(request.origin).host}
            request={request}
          />
        </div>
      )}
      <div className={stackStyles}>
        {/* No partition: the engine denies notifications to a page in one. */}
        <webview
          className={viewStyles}
          data-loading={loading ? "" : undefined}
          ref={setView}
          src={url}
        />
        {loading && (
          <div className={coverStyles}>
            <Loading>{`Opening ${inbox.name}…`}</Loading>
          </div>
        )}
      </div>
    </div>
  );
};

// Fills the drawer, which widens for a page's list and conversation side by
// side.
const pageStyles = flex({
  "&[hidden]": { display: "none" },
  direction: "column",
  flex: 1,
  minBlockSize: 0,
});

const askStyles = css({ paddingBlockEnd: 2 });

// The view and, in its place while it loads, what it is waiting for. The view
// stays in the layout, hidden, so it keeps loading.
const stackStyles = flex({
  direction: "column",
  flex: 1,
  minBlockSize: 0,
  position: "relative",
});

const coverStyles = flex({ inset: 0, position: "absolute" });

const viewStyles = css({
  "&[data-loading]": { opacity: 0 },
  borderStyle: "none",
  display: "block",
  flex: 1,
  inlineSize: "full",
  minBlockSize: 0,
});
