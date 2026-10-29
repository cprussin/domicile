import { Button } from "@domicile-desktop/component-library/Button";
import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { List } from "@domicile-desktop/component-library/ListRow";
import { PanelFooter } from "@domicile-desktop/component-library/PanelFooter";
import { PanelHeader } from "@domicile-desktop/component-library/PanelHeader";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Switch } from "@domicile-desktop/component-library/Switch";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import type { CSSProperties } from "react";
import { memo, useCallback } from "react";

import { css, cva } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import type { Row } from "./drawer-rows";
import { InboxList } from "./InboxList";
import { InboxPage } from "./InboxPage";
import type { Inbox, InboxReading } from "./inbox";
import { InboxKind } from "./inbox";
import { NotificationCard } from "./NotificationCard";
import type { NotificationsHandle } from "./notifications-context";
import { bellId, screenOfBell } from "./notifications-context";
import { useDrawerRows } from "./useDrawerRows";

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
  /** Toasts are held back, but for critical ones. */
  doNotDisturb: boolean;
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
  /** Turn do not disturb on or off. */
  onDoNotDisturb: (on: boolean) => void;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
  /** Send `text` from `id`'s reply field. */
  onReply: (id: number, text: string) => void;
};

/**
 * The notification drawer, a panel under the bell. Each notification can be
 * pressed or cleared, or all cleared at once. A press closes the drawer,
 * which would cover the window it raises. Do not disturb is switched in its
 * footer.
 *
 * A notification stays here after its toast is gone, until it is cleared or its
 * application withdraws it. See docs/architecture/NOTIFICATIONS.md.
 *
 * Inboxes are listed above the notifications. An inbox with a page, such as
 * Messages, draws it here, widened, in place of the list.
 *
 * A notification cleared while the list shows slides out, then the rows below
 * close up. Several cleared at once leave in turn, top to bottom.
 */
export const NotificationDrawer = memo(
  ({
    doNotDisturb,
    handle,
    inboxes,
    items,
    now,
    onAction,
    onBack,
    onClose,
    onDismiss,
    onDoNotDisturb,
    onOpen,
    onReply,
    open,
    screen,
  }: Props) => {
    const page =
      inboxes?.shown === undefined ? undefined : inboxes.inboxes[inboxes.shown];
    const { onLeft, rows } = useDrawerRows(items, open && page === undefined);
    const notifications = (
      <Notifications
        now={now}
        onAction={onAction}
        onClose={onClose}
        onDismiss={onDismiss}
        onLeft={onLeft}
        onReply={onReply}
        rows={rows}
      />
    );
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
        tone="overPhoto"
        triggerId={screen === undefined ? null : bellId(screen)}
      >
        <section
          aria-labelledby={TITLE_ID}
          className={drawerStyles({ page: page !== undefined })}
        >
          <PanelHeader
            onBack={page === undefined ? undefined : onBack}
            title={page === undefined ? "Notifications" : page.name}
            titleId={TITLE_ID}
          />
          {/* Hidden, not unmounted, so the inboxes' pages keep running. */}
          <div className={paneStyles} hidden={page !== undefined}>
            {inboxes !== undefined && (
              <PanelSection label="Inboxes">
                <List>
                  <InboxList
                    inboxes={inboxes.inboxes}
                    onOpen={inboxes.onOpen}
                    readings={inboxes.readings}
                  />
                </List>
              </PanelSection>
            )}
            {inboxes === undefined ? (
              notifications
            ) : (
              <PanelSection label="Recent">{notifications}</PanelSection>
            )}
          </div>
          {page === undefined && (
            <PanelFooter
              action={
                items.length > 0 && (
                  <Button
                    beforeIcon={<BroomIcon aria-hidden size={14} />}
                    onClick={() => {
                      onDismiss(items.map(({ id }) => id));
                    }}
                    rounded
                    size="xs"
                    variant="ghost"
                  >
                    Clear all
                  </Button>
                )
              }
            >
              <Switch
                checked={doNotDisturb}
                label="Do not disturb"
                onCheckedChange={onDoNotDisturb}
              />
            </PanelFooter>
          )}
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
  "now" | "onAction" | "onClose" | "onDismiss" | "onReply"
> & {
  rows: readonly Row[];
  /** The row of notification `id` has finished leaving. */
  onLeft: (id: number) => void;
};

/** The notifications, or that there are none once the last has left. */
const Notifications = ({
  now,
  onAction,
  onClose,
  onDismiss,
  onLeft,
  onReply,
  rows,
}: NotificationsProps) =>
  rows.length === 0 ? (
    <div className={caughtUpStyles}>
      <EmptyState icon={BellSimpleIcon} title="You're all caught up" />
    </div>
  ) : (
    <ul className={listStyles}>
      {rows.map(({ leaving, notification }) => (
        <li
          aria-hidden={leaving === undefined ? undefined : true}
          className={rowStyles}
          data-leaving={leaving === undefined ? undefined : ""}
          inert={leaving !== undefined}
          key={notification.id}
          onTransitionEnd={(event) => {
            // The height closes last.
            if (
              leaving !== undefined &&
              event.target === event.currentTarget &&
              event.propertyName === "grid-template-rows"
            ) {
              onLeft(notification.id);
            }
          }}
          style={
            leaving === undefined
              ? undefined
              : // Not a token: a place the leaving delay is multiplied by.
                ({ "--leave-order": Math.min(leaving, 8) } as CSSProperties)
          }
        >
          <div className={cardBoxStyles}>
            <NotificationCard
              closeLabel="Clear"
              density="compact"
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
          </div>
        </li>
      ))}
    </ul>
  );

// The usual popover's width for the list, widened for a page's list and
// conversation side by side. The list scrolls past most of the screen's
// height.
const drawerStyles = cva({
  base: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    maxBlockSize: "80vh",
  },
  variants: {
    // The padding evens out the panel's, which is thinner above and below,
    // as in quick settings.
    page: {
      false: { inlineSize: 80, paddingBlock: 1.5 },
      true: {
        blockSize: "min({spacing.160}, 80vh)",
        inlineSize: "min({spacing.140}, 90vw)",
        padding: 3,
      },
    },
  },
});

// Fills the drawer's body; scrolls when the notifications outgrow it.
const paneStyles = flex({
  "&[hidden]": { display: "none" },
  direction: "column",
  flex: 1,
  gap: 3,
  minBlockSize: 0,
  overflowY: "auto",
});

const listStyles = flex({
  direction: "column",
  gap: 1,
  listStyle: "none",
  margin: 0,
  paddingInline: 0,
});

// Each card on its own tile, lit on hover, as a list's filled rows. A card
// that arrives while the drawer is open slides in like a toast. A cleared one
// slides out, then closes its height and the list's gap below it; the row is a
// one-row grid so the height can close.
const rowStyles = css({
  _hover: { backgroundColor: "fillHover" },
  _starting: {
    opacity: 0,
    transform: "translateX({spacing.4})",
  },
  // Critical notifications get a danger ring, as their toasts do. A ring
  // drawn inside, as a border would keep the closed row a line high.
  "&:has([data-urgency=critical])": {
    boxShadow:
      "inset 0 0 0 1px color-mix(in oklab, {colors.danger} 55%, transparent)",
  },
  "&[data-leaving]": {
    gridTemplateRows: "0fr",
    marginBlockEnd: "calc(-1 * {spacing.1})",
    opacity: 0,
    pointerEvents: "none",
    transform: "translateX({spacing.6})",
    transition:
      "opacity {durations.normal} {easings.in} calc(var(--leave-order) * {durations.fastest}), transform {durations.normal} {easings.in} calc(var(--leave-order) * {durations.fastest}), grid-template-rows {durations.normal} {easings.in-out} calc(var(--leave-order) * {durations.fastest} + {durations.normal}), margin-block-end {durations.normal} {easings.in-out} calc(var(--leave-order) * {durations.fastest} + {durations.normal})",
  },
  backgroundColor: "fill",
  borderRadius: "lg",
  display: "grid",
  gridTemplateRows: "1fr",
  marginBlockEnd: 0,
  opacity: 1,
  overflow: "hidden",
  transform: "translateX(0)",
  transition:
    "background-color {durations.fast} {easings.default}, box-shadow {durations.fast} {easings.default}, opacity {durations.slow} {easings.outQuart}, transform {durations.slow} {easings.outQuart}, grid-template-rows {durations.normal} {easings.in-out}, margin-block-end {durations.normal} {easings.in-out}",
});

// Lets the row close past the card's padding.
const cardBoxStyles = css({ minBlockSize: 0 });

// Fades in as the last cleared row leaves.
const caughtUpStyles = css({
  _starting: { opacity: 0 },
  opacity: 1,
  transition: "opacity {durations.slow} {easings.out}",
});
