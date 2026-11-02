import { Button } from "@domicile-desktop/component-library/Button";
import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { LeavingRow } from "@domicile-desktop/component-library/LeavingRow";
import { List } from "@domicile-desktop/component-library/ListRow";
import type { Row } from "@domicile-desktop/component-library/leaving-rows";
import { PanelFooter } from "@domicile-desktop/component-library/PanelFooter";
import { PanelHeader } from "@domicile-desktop/component-library/PanelHeader";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Switch } from "@domicile-desktop/component-library/Switch";
import { useLeavingRows } from "@domicile-desktop/component-library/useLeavingRows";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import { memo } from "react";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import { InboxList } from "./InboxList";
import type { Inbox, InboxReading } from "./inbox";
import { NotificationCard } from "./NotificationCard";
import type { NotificationsHandle } from "./notifications-context";
import { bellId, screenOfBell } from "./notifications-context";

/** The inboxes listed in the drawer, and what the shell knows of them. */
export type DrawerInboxes = {
  inboxes: readonly Inbox[];
  /** Each inbox's reading, by its place in `inboxes`. */
  readings: readonly (InboxReading | undefined)[];
  /** Opens the inbox at `index`, as its row was pressed. */
  onOpen: (index: number) => void;
};

type Props = {
  /** Toasts are held back, but for critical ones. */
  doNotDisturb: boolean;
  /** Opens it under the bell pressed. */
  handle: NotificationsHandle;
  /** The inboxes, listed above the notifications. */
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
 * Inboxes are listed above the notifications. A press opens one in its own
 * window, and closes the drawer.
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
    onClose,
    onDismiss,
    onDoNotDisturb,
    onOpen,
    onReply,
    open,
    screen,
  }: Props) => {
    const { onLeft, rows } = useLeavingRows(items, idOf, open);
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
        handle={handle}
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
        <section aria-labelledby={TITLE_ID} className={drawerStyles}>
          <PanelHeader title="Notifications" titleId={TITLE_ID} />
          <div className={paneStyles}>
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
        </section>
      </Popover>
    );
  },
);

/** Tells one notification from another. */
const idOf = ({ id }: Notification): number => id;

/** Names the drawer for assistive tech. One drawer per page. */
const TITLE_ID = "notification-drawer-title";

type NotificationsProps = Pick<
  Props,
  "now" | "onAction" | "onClose" | "onDismiss" | "onReply"
> & {
  rows: readonly Row<Notification>[];
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
    <ul
      className={listStyles}
      data-emptying={
        rows.every(({ leaving }) => leaving !== undefined) ? "" : undefined
      }
    >
      {rows.map(({ arriving, item: notification, leaving }) => (
        <LeavingRow
          key={notification.id}
          motion={{
            arriving,
            leaving,
            onLeft: () => {
              onLeft(notification.id);
            },
          }}
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
        </LeavingRow>
      ))}
    </ul>
  );

// The usual popover's width. The list scrolls past most of the screen's
// height. The padding evens out the panel's, which is thinner above and
// below, as in quick settings.
const drawerStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  inlineSize: 80,
  maxBlockSize: "80vh",
  paddingBlock: 1.5,
});

// Fills the drawer's body; scrolls when the notifications outgrow it.
const paneStyles = flex({
  direction: "column",
  flex: 1,
  gap: 3,
  minBlockSize: 0,
  overflowY: "auto",
});

// Clips the rows sliding in and out sideways, and a closing last row, which
// sits below the list's end as its gap closes. Either would otherwise scroll
// the pane and flash its scrollbars.
//
// As the last rows leave, it eases to the caught-up note's height while they
// slide out, before they close. So the drawer goes straight to the note's
// height, rather than shrinking to nothing and growing back for it.
const listStyles = flex({
  // `EmptyState`'s height.
  "&[data-emptying]": { minBlockSize: 40 },
  direction: "column",
  gap: 1,
  listStyle: "none",
  margin: 0,
  minBlockSize: 0,
  overflowX: "clip",
  overflowY: "clip",
  paddingInline: 0,
  transition: "min-block-size {durations.normal} {easings.in-out}",
});

// Each card on its own tile, lit on hover, as a list's filled rows. Its row
// slides in and out as `LeavingRow` moves it, so the tile, not the row, takes
// the hover and the ring, and closes with it.
const cardBoxStyles = css({
  _hover: { backgroundColor: "fillHover" },
  // Critical notifications get a danger ring, as their toasts do. A ring
  // drawn inside, as a border would keep the closed row a line high.
  "&:has([data-urgency=critical])": {
    boxShadow:
      "inset 0 0 0 1px color-mix(in oklab, {colors.danger} 55%, transparent)",
  },
  backgroundColor: "fill",
  borderRadius: "lg",
  minBlockSize: 0,
  transition:
    "background-color {durations.fast} {easings.default}, box-shadow {durations.fast} {easings.default}",
});

// Fades in as the last cleared row leaves.
const caughtUpStyles = css({
  _starting: { opacity: 0 },
  opacity: 1,
  transition: "opacity {durations.slow} {easings.out}",
});
