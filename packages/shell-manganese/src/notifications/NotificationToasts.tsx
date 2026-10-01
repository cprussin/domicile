import type { Notification } from "@domicile/chrome-sdk/notification";
import type { ToastManager } from "@domicile/component-library/Toaster";
import { Toaster, useToastManager } from "@domicile/component-library/Toaster";

import { css } from "../../styled-system/css";
import { TOP_BAR } from "../top-bar/TopBar";
import { NotificationCard } from "./NotificationCard";

/** The most toasts up at once; the rest wait in the drawer. */
const MOST_SHOWN = 4;

type Props = {
  /** What says which toasts are up — `useNotifications` adds to it. */
  manager: ToastManager;
  /** The time now, for how long ago each arrived. */
  now: number;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
  /**
   * Whether toasts are drawn now: not over a locked desk, whose lock screen
   * they would read out to whoever is in front of it.
   */
  shown: boolean;
};

/**
 * Notifications as they arrive: a deck of toasts in the top trailing corner,
 * under the bar and over the windows, each the same card the drawer lists.
 *
 * Putting a toast away — the cross, a swipe, its time running out — is only
 * that: the notification is still in the drawer. Pressing one takes its
 * action, which its application answers and the compositor then lets go of.
 */
export const NotificationToasts = ({
  manager,
  now,
  onAction,
  shown,
}: Props) => (
  <Toaster.Provider limit={MOST_SHOWN} toastManager={manager}>
    {shown && (
      <div className={regionStyles} style={{ insetBlockStart: `${TOP_BAR}px` }}>
        <Deck now={now} onAction={onAction} />
      </div>
    )}
  </Toaster.Provider>
);

/** The toaster, inside the provider whose toasts it draws. */
const Deck = ({ now, onAction }: Pick<Props, "now" | "onAction">) => {
  const { close } = useToastManager();
  return (
    <Toaster<Notification> label="Notifications">
      {(toast) => {
        const notification = toastNotification(toast.data);
        return (
          <NotificationCard
            body={<Toaster.Description />}
            closeLabel="Dismiss"
            notification={notification}
            now={now}
            onAction={(key, event) => {
              // The release at the end of a swipe that put it away is not a
              // press on it.
              if (
                event.currentTarget.closest("[data-swipe-direction]") === null
              ) {
                onAction(notification.id, key);
              }
            }}
            onClose={() => {
              close(toast.id);
            }}
            summary={<Toaster.Title />}
          />
        );
      }}
    </Toaster>
  );
};

/**
 * The notification a toast was added for. Every toast here is added by
 * `useNotifications` with one, so a toast without is a bug in that, and
 * throws.
 */
const toastNotification = (data: Notification | undefined): Notification => {
  if (data === undefined) {
    throw new Error(
      "a notification's toast was added without its notification",
    );
  } else {
    return data;
  }
};

// The box the deck is laid out in: the trailing corner of the screen, from
// just under the bar, inset from the edge by the gap the bar keeps. Fixed, so
// it is over the windows wherever they are, and it takes no pointer itself —
// only the cards do — so the windows under its empty part are still theirs.
const regionStyles = css({
  "& > *": {
    pointerEvents: "auto",
  },
  inlineSize: "min({spacing.96}, calc(100vw - {spacing.6}))",
  insetInlineEnd: 3,
  marginBlockStart: 2,
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});
