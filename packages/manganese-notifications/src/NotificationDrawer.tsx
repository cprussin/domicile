import { Button } from "@domicile-desktop/component-library/Button";
import { SlideOver } from "@domicile-desktop/component-library/SlideOver";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import { memo, useCallback } from "react";

import { css } from "../styled-system/css";
import { center, flex, vstack } from "../styled-system/patterns";
import { InboxList } from "./InboxList";
import { InboxPage } from "./InboxPage";
import type { Inbox, InboxReading } from "./inbox";
import { InboxKind } from "./inbox";
import { NotificationCard } from "./NotificationCard";

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
  /** The screen it opens on: the one whose bell was pressed. */
  screen: string | undefined;
  onOpenChange: (open: boolean) => void;
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
 * The notification drawer, sliding out from the bell's edge. Each notification
 * can be pressed or cleared, or all cleared at once. A press closes the drawer,
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
    inboxes,
    items,
    now,
    onAction,
    onBack,
    onDismiss,
    onOpenChange,
    onReply,
    open,
    screen,
  }: Props) => {
    const page =
      inboxes?.shown === undefined ? undefined : inboxes.inboxes[inboxes.shown];
    return (
      <SlideOver
        footer={
          items.length === 0 || page !== undefined ? undefined : (
            <div className={footerStyles}>
              <span className={countStyles}>
                {items.length === 1
                  ? "1 notification"
                  : `${items.length} notifications`}
              </span>
              <Button
                beforeIcon={<BroomIcon />}
                onClick={() => {
                  onDismiss(items.map(({ id }) => id));
                }}
                size="sm"
                variant="ghost"
              >
                Clear all
              </Button>
            </div>
          )
        }
        keepMounted={inboxes !== undefined}
        onBack={page === undefined ? undefined : onBack}
        onOpenChange={onOpenChange}
        open={open}
        screen={screen}
        title={page === undefined ? "Notifications" : page.name}
        wide={page !== undefined}
      >
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
            onDismiss={onDismiss}
            onOpenChange={onOpenChange}
            onReply={onReply}
          />
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
      </SlideOver>
    );
  },
);

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
  "items" | "now" | "onAction" | "onDismiss" | "onOpenChange" | "onReply"
>;

/** The notifications, or that there are none. */
const Notifications = ({
  items,
  now,
  onAction,
  onDismiss,
  onOpenChange,
  onReply,
}: NotificationsProps) =>
  items.length === 0 ? (
    <div className={emptyStyles}>
      <span aria-hidden className={glowStyles}>
        <BellSimpleIcon size={28} weight="duotone" />
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
              onOpenChange(false);
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

// Fills the drawer's body, for a page's full height.
const paneStyles = flex({
  "&[hidden]": { display: "none" },
  direction: "column",
  flex: 1,
  minBlockSize: 0,
});

const headingStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "semibold",
  margin: 0,
  paddingBlock: 1,
});

const inboxListStyles = flex({
  direction: "column",
  gap: 0.5,
  margin: 0,
  paddingBlockEnd: 2,
  paddingInline: 0,
});

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  paddingBlock: 1,
  paddingInline: 0,
});

// Each card on its own surface, lifted on hover. A card that arrives while the
// drawer is open slides in like a toast.
const rowStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 7%, transparent)",
    borderColor: "color-mix(in oklab, {colors.foreground} 16%, transparent)",
  },
  _starting: {
    opacity: 0,
    transform: "translateX({spacing.4})",
  },
  // Critical notifications get a danger ring, as their toasts do.
  "&:has([data-urgency=critical])": {
    borderColor: "color-mix(in oklab, {colors.danger} 55%, transparent)",
  },
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 9%, transparent)",
  borderRadius: "xl",
  opacity: 1,
  overflow: "hidden",
  transform: "translateX(0)",
  transition:
    "background-color {durations.fast} {easings.default}, border-color {durations.fast} {easings.default}, opacity {durations.slow} {easings.outQuart}, transform {durations.slow} {easings.outQuart}",
});

const footerStyles = flex({
  align: "center",
  flex: 1,
  justify: "space-between",
});

const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});

const emptyStyles = vstack({
  flex: 1,
  gap: 2,
  justify: "center",
  paddingBlock: 16,
  textAlign: "center",
});

// The empty state: no notifications is the normal case, not an error.
const glowStyles = center({
  backgroundImage:
    "radial-gradient(circle, color-mix(in oklab, {colors.accent} 28%, transparent), transparent 70%)",
  blockSize: 20,
  color: "accent",
  inlineSize: 20,
  marginBlockEnd: 1,
});

const emptyTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
});

const emptyBodyStyles = css({
  color: "muted",
  fontSize: "sm",
  maxInlineSize: 64,
});
