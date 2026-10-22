/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import type { createHandle } from "@domicile-desktop/component-library/Popover";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { useKeepsKeyboard } from "@domicile-desktop/manganese-bar/panel-keyboard";
import { PermissionAsk } from "@domicile-desktop/manganese-page-requests/PermissionAsk";
import { usePermissionRequest } from "@domicile-desktop/manganese-page-requests/usePermissionRequest";
import { WEBVIEW_FOCUS_REQUEST_EVENT } from "@domicile-desktop/sdk/webview-element";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";
import { useEffect, useState } from "react";
import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

const MESSAGES_URL = "https://messages.google.com/web/";

type Handle = ReturnType<typeof createHandle>;

type Props = {
  /** Whether this bar draws the page. Exactly one bar does. */
  drawsPage: boolean;
  /** Opens the panel from any bar. */
  handle: Handle;
  /** The panel opened. */
  onOpen: () => void;
  /** The bar's monitor. */
  screen: string;
  /** How many of Messages' notifications are uncleared. */
  unread: number;
};

/**
 * The item: a button with the count of new messages, which opens Messages in
 * a panel. The bar that draws the page holds the panel; the others' buttons
 * open it under themselves.
 */
export const Messages = ({
  drawsPage,
  handle,
  onOpen,
  screen,
  unread,
}: Props) => {
  const id = triggerId(screen);
  const trigger = (
    <Popover.Trigger handle={handle} id={id} render={count(unread)} />
  );
  return drawsPage ? (
    <>
      {trigger}
      <Panel handle={handle} onOpen={onOpen} triggerId={id} />
    </>
  ) : (
    trigger
  );
};

type PanelProps = {
  handle: Handle;
  onOpen: () => void;
  /** The id of this bar's button, to open under on the page's request. */
  triggerId: string;
};

/**
 * The panel, kept mounted so the page keeps running while it is closed. It
 * keeps the keyboard while open, for typing into the page.
 */
const Panel = ({ handle, onOpen, triggerId }: PanelProps) => {
  const [open, setOpen] = useState(false);
  useKeepsKeyboard(open);
  return (
    <Popover
      align="end"
      flush
      handle={handle}
      keepMounted
      onOpenChange={(opened) => {
        setOpen(opened);
        if (opened) {
          onOpen();
        }
      }}
    >
      <Page
        onShow={() => {
          handle.open(triggerId);
        }}
      />
    </Popover>
  );
};

/**
 * Messages' page, with its permission requests asked above it. `onShow` is
 * the page asking to be shown, as on a press of its notification.
 */
const Page = ({ onShow }: { onShow: () => void }) => {
  // `null` because React passes it to a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  const request = usePermissionRequest(view);

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

  return (
    <>
      {request !== undefined && (
        <div className={askStyles}>
          <PermissionAsk
            asker={new URL(request.origin).host}
            request={request}
          />
        </div>
      )}
      {/* No partition: the engine denies notifications to a page in one. */}
      <webview className={viewStyles} ref={setView} src={MESSAGES_URL} />
    </>
  );
};

/** The bar's button, lit with the count while there are new messages. */
const count = (unread: number) => (
  <button
    aria-label={
      unread === 0 ? "Messages" : `Messages: ${unread.toString()} new`
    }
    className={itemStyles}
    data-unread={unread > 0}
    type="button"
  >
    <ChatCircleTextIcon aria-hidden size={15} weight="bold" />
    {unread > 0 && <span className={figureStyles}>{unread}</span>}
  </button>
);

/** The id of `screen`'s button, for opening the panel under it. */
const triggerId = (screen: string) => `google-messages-${screen}`;

// Matches the Gmail item, lit as it is for unread mail.
const itemStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  "&[data-unread=true]": {
    backgroundColor: "color-mix(in oklab, white 24%, transparent)",
  },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flexShrink: 0,
  font: "inherit",
  gap: 1,
  justifyContent: "center",
  paddingBlock: 0,
  // The ends' radius, so the icon and count stay clear of the curve.
  paddingInline: 3,
  transition: "background-color {durations.fast} {easings.default}",
});

// 10px to match the bar's other figures; no font-size token fits. Fixed-width
// digits, so the bar does not shift as the count changes.
const figureStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "semibold",
  whiteSpace: "nowrap",
});

// The panel is flush, so the request gets its own inset.
const askStyles = css({ padding: 2 });

// Wide enough for Messages' list and conversation side by side, within the
// screen. `display: block` avoids a line-box gap under it in the panel.
const viewStyles = css({
  blockSize: "min({spacing.160}, 80vh)",
  borderStyle: "none",
  display: "block",
  inlineSize: "min({spacing.240}, 90vw)",
});
