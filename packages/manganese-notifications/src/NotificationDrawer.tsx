import { Popover } from "@domicile-desktop/component-library/Popover";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { memo, useCallback } from "react";

import { css, cva } from "../styled-system/css";
import { flex, hstack, vstack } from "../styled-system/patterns";
import { InboxList } from "./InboxList";
import { InboxPage } from "./InboxPage";
import type { Inbox, InboxReading } from "./inbox";
import { InboxKind } from "./inbox";
import { NotificationCard } from "./NotificationCard";
import type { NotificationsHandle } from "./notifications-context";
import { bellId, screenOfBell } from "./notifications-context";

/** The inboxes listed in the drawer, and what the shell knows of them. */
export type DrawerInboxes = {
  inboxes: readonly Inbox[];
  /** Each inbox's reading, by its place in `inboxes`. */
  readings: readonly (InboxReading | undefined)[];
  /** The place of the inbox whose page the drawer shows, if any. */
  shown: number | undefined;
  /** Opens the inbox at `index`, as its row was pressed. */
  onOpen: (index: number) => void;
  /** Shows the page at `index`, which asked to be shown. */
  onShow: (index: number) => void;
  /** The page at `index` counted `unread` unread conversations. */
  onUnread: (index: number, unread: number) => void;
};

type Props = {
  /** Opens it under the bell pressed. */
  handle: NotificationsHandle;
  /**
   * The inboxes, listed above the notifications. Their pages stay loaded
   * while the drawer is closed, so their counts stay current.
   */
  inboxes?: DrawerInboxes | undefined;
  /** Every uncleared notification, in display order. */
  items: readonly Notification[];
  /** The current time, for the relative timestamps. */
  now: number;
  open: boolean;
  /** The monitor whose bell it opens under. */
  screen: string | undefined;
  /** The bell on monitor `screen` was pressed. */
  onOpen: (screen: string) => void;
  onClose: () => void;
  /** Leave an inbox's page for the list. */
  onBack: () => void;
  /** Clear `ids`. */
  onDismiss: (ids: readonly number[]) => void;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
  /** Send `text` from `id`'s reply field. */
  onReply: (id: number, text: string) => void;
};

/**
 * The notification drawer, a panel under the bell. Each notification can be
 * pressed or cleared, or all cleared at once. A press closes the drawer,
 * which would cover the window it raises.
 *
 * A notification stays here after its toast is gone, until it is cleared or its
 * application withdraws it. See docs/architecture/NOTIFICATIONS.md.
 *
 * Inboxes are listed above the notifications. An inbox with a page, such as
 * Messages, draws it here, widened, in place of the list.
 */
export const NotificationDrawer = memo(
  ({
    handle,
    inboxes,
    items,
    now,
    onAction,
    onBack,
    onClose,
    onDismiss,
    onOpen,
    onReply,
    open,
    screen,
  }: Props) => {
    const page =
      inboxes?.shown === undefined ? undefined : inboxes.inboxes[inboxes.shown];
    return (
      <Popover
        align="end"
        // A page draws its own padding, past the usual width cap.
        flush={page !== undefined}
        handle={handle}
        keepMounted={inboxes !== undefined}
        onOpenChange={(opened, { trigger }) => {
          if (opened) {
            onOpen(screenOfBell(trigger));
          } else {
            onClose();
          }
        }}
        open={open}
        triggerId={screen === undefined ? null : bellId(screen)}
      >
        <section
          aria-labelledby={TITLE_ID}
          className={drawerStyles({ page: page !== undefined })}
        >
          <header className={headerStyles}>
            {page !== undefined && (
              <button
                aria-label="Back"
                className={backStyles}
                onClick={onBack}
                type="button"
              >
                <CaretLeftIcon aria-hidden size={14} weight="bold" />
              </button>
            )}
            <h2 className={titleStyles} id={TITLE_ID}>
              {page === undefined ? "Notifications" : page.name}
            </h2>
          </header>
          {/* Hidden, not unmounted, so the inboxes' pages keep running. */}
          <div className={paneStyles} hidden={page !== undefined}>
            {inboxes !== undefined && (
              <>
                <h3 className={headingStyles}>Inboxes</h3>
                <ul className={inboxListStyles}>
                  <InboxList
                    inboxes={inboxes.inboxes}
                    onOpen={inboxes.onOpen}
                    readings={inboxes.readings}
                  />
                </ul>
                <h3 className={headingStyles}>Recent</h3>
              </>
            )}
            <Notifications
              items={items}
              now={now}
              onAction={onAction}
              onClose={onClose}
              onDismiss={onDismiss}
              onReply={onReply}
            />
            {items.length > 0 && (
              <footer className={footerStyles}>
                <span className={countStyles}>
                  {items.length === 1
                    ? "1 notification"
                    : `${items.length.toString()} notifications`}
                </span>
                <button
                  className={clearStyles}
                  onClick={() => {
                    onDismiss(items.map(({ id }) => id));
                  }}
                  type="button"
                >
                  <BroomIcon aria-hidden size={14} />
                  Clear all
                </button>
              </footer>
            )}
          </div>
          {inboxes?.inboxes.map((inbox, index) =>
            inbox.kind === InboxKind.Page ? (
              <Page
                inbox={inbox}
                index={index}
                key={index}
                onShow={inboxes.onShow}
                onUnread={inboxes.onUnread}
                shown={inboxes.shown === index}
              />
            ) : undefined,
          )}
        </section>
      </Popover>
    );
  },
);

/** Names the drawer for assistive tech. One drawer per page. */
const TITLE_ID = "notification-drawer-title";

type PageProps = {
  inbox: Extract<Inbox, { kind: InboxKind.Page }>;
  index: number;
  shown: boolean;
} & Pick<DrawerInboxes, "onShow" | "onUnread">;

/** The page at `index`, told its place, so its watches start once. */
const Page = ({ inbox, index, onShow, onUnread, shown }: PageProps) => {
  const show = useCallback(() => {
    onShow(index);
  }, [index, onShow]);
  const count = useCallback(
    (unread: number) => {
      onUnread(index, unread);
    },
    [index, onUnread],
  );
  return (
    <InboxPage inbox={inbox} onShow={show} onUnread={count} shown={shown} />
  );
};

type NotificationsProps = Pick<
  Props,
  "items" | "now" | "onAction" | "onClose" | "onDismiss" | "onReply"
>;

/** The notifications, or that there are none. */
const Notifications = ({
  items,
  now,
  onAction,
  onClose,
  onDismiss,
  onReply,
}: NotificationsProps) =>
  items.length === 0 ? (
    <div className={emptyStyles}>
      <span aria-hidden className={glowStyles}>
        <BellSimpleIcon size={20} weight="duotone" />
      </span>
      <span className={emptyTitleStyles}>You're all caught up</span>
      <span className={emptyBodyStyles}>
        What your applications and sites have to say will be here.
      </span>
    </div>
  ) : (
    <ul className={listStyles}>
      {items.map((notification) => (
        <li className={rowStyles} key={notification.id}>
          <NotificationCard
            closeLabel="Clear"
            notification={notification}
            now={now}
            onAction={(key) => {
              onAction(notification.id, key);
              // Out of the way of the window the action raises.
              onClose();
            }}
            onClose={() => {
              onDismiss([notification.id]);
            }}
            onReply={(text) => {
              onReply(notification.id, text);
            }}
          />
        </li>
      ))}
    </ul>
  );

// The usual popover's width for the list, widened for a page's list and
// conversation side by side. The list scrolls past most of the screen's
// height.
const drawerStyles = cva({
  base: {
    color: "foreground",
    display: "flex",
    flexDirection: "column",
    fontSize: "sm",
    gap: 2.5,
    maxBlockSize: "80vh",
  },
  variants: {
    page: {
      false: { inlineSize: 80 },
      true: {
        blockSize: "min({spacing.160}, 80vh)",
        inlineSize: "min({spacing.140}, 90vw)",
        padding: 3,
      },
    },
  },
});

const headerStyles = hstack({ gap: 1, minBlockSize: 6 });

// The tray's hover circle, as quick settings' arrows.
const backStyles = css({
  _focusVisible: {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: 0.5,
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  padding: 0,
});

const titleStyles = css({
  fontSize: "md",
  fontWeight: "semibold",
  lineHeight: "tight",
  margin: 0,
});

// Fills the drawer's body; scrolls when the notifications outgrow it.
const paneStyles = flex({
  "&[hidden]": { display: "none" },
  direction: "column",
  flex: 1,
  gap: 1.5,
  minBlockSize: 0,
  overflowY: "auto",
});

// The section labels used in the portal's source picker.
const headingStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "medium",
  letterSpacing: "wide",
  margin: 0,
  paddingBlockStart: 1,
  textTransform: "uppercase",
});

const inboxListStyles = flex({
  direction: "column",
  gap: 0.5,
  margin: 0,
  paddingInline: 0,
});

const listStyles = flex({
  direction: "column",
  gap: 1.5,
  listStyle: "none",
  margin: 0,
  paddingInline: 0,
});

// Each card on its own tile, lit on hover. A card that arrives while the
// drawer is open slides in like a toast.
const rowStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
  },
  _starting: {
    opacity: 0,
    transform: "translateX({spacing.4})",
  },
  // Critical notifications get a danger ring, as their toasts do.
  "&:has([data-urgency=critical])": {
    borderColor: "color-mix(in oklab, {colors.danger} 55%, transparent)",
  },
  backgroundColor: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
  border: "1px solid transparent",
  borderRadius: "lg",
  opacity: 1,
  overflow: "hidden",
  transform: "translateX(0)",
  transition:
    "background-color {durations.fast} {easings.default}, border-color {durations.fast} {easings.default}, opacity {durations.slow} {easings.outQuart}, transform {durations.slow} {easings.outQuart}",
});

// Quieter than the notifications above it, as quick settings' battery line.
const footerStyles = hstack({
  borderBlockStartColor: "border",
  borderBlockStartStyle: "solid",
  borderBlockStartWidth: "1px",
  fontSize: "xs",
  justify: "space-between",
  marginBlockStart: 1,
  paddingBlockStart: 2,
});

const countStyles = css({
  color: "muted",
  fontVariantNumeric: "tabular-nums",
});

// As quick settings' Settings button.
const clearStyles = hstack({
  _focusVisible: {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: 0.5,
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "muted",
  cursor: "pointer",
  flexShrink: 0,
  fontSize: "xs",
  gap: 1.5,
  marginInlineEnd: -2.5,
  paddingInline: 2.5,
  transition: "background-color {durations.fast} {easings.default}",
});

// The empty state: no notifications is the normal case, not an error.
const emptyStyles = vstack({
  color: "muted",
  gap: 1,
  paddingBlock: 6,
  textAlign: "center",
});

const glowStyles = css({ color: "accent", display: "inline-flex" });

const emptyTitleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
});

const emptyBodyStyles = css({
  fontSize: "xs",
  maxInlineSize: 56,
});
