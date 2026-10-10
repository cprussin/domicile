import { useScreenRegion } from "@domicile-desktop/component-library/DisplayProvider";
import type { ToastManager } from "@domicile-desktop/component-library/Toaster";
import {
  Toaster,
  useToastManager,
} from "@domicile-desktop/component-library/Toaster";
import type { Notification } from "@domicile-desktop/sdk/notification";

import { css } from "../../styled-system/css";
import { TOP_BAR } from "../top-bar/TopBar";
import { NotificationCard } from "./NotificationCard";

/** The most toasts shown at once; the rest are only in the drawer. */
const MOST_SHOWN = 4;

type Props = {
  /** The toast manager; `useNotifications` adds to it. */
  manager: ToastManager;
  /** The current time, for the relative timestamps. */
  now: number;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
  /** The screen to toast on: the one with the keyboard. */
  screen: string;
  /**
   * Whether to show toasts. False while locked, so the lock screen does not
   * show notification content.
   */
  shown: boolean;
};

/**
 * Toasts for new notifications, stacked in the top trailing corner of `screen`
 * under its bar and over windows. Each uses the drawer's card.
 *
 * Dismissing a toast (close, swipe or timeout) leaves the notification in the
 * drawer. Pressing one takes its action.
 */
export const NotificationToasts = ({
  manager,
  now,
  onAction,
  screen,
  shown,
}: Props) => {
  const region = useScreenRegion(screen);
  return (
    <Toaster.Provider limit={MOST_SHOWN} toastManager={manager}>
      {shown && (
        <div className={screenStyles} style={region}>
          <div
            className={regionStyles}
            style={{ insetBlockStart: `${TOP_BAR}px` }}
          >
            <Deck now={now} onAction={onAction} />
          </div>
        </div>
      )}
    </Toaster.Provider>
  );
};

/** Renders the toasts inside their provider. */
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
              // Ignore the pointer release that ends a dismissing swipe.
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
 * The notification a toast was added for. `useNotifications` always attaches
 * one, so a missing one is a bug and throws.
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

// The toasting screen's box. Fixed so it stays over windows, and it ignores the
// pointer so windows under its empty area stay clickable. Clips, so a toast
// slides in from its screen's edge rather than over the next monitor.
const screenStyles = css({
  inset: 0,
  overflow: "clip",
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});

// The toast region: the trailing corner, under the bar, inset by the bar's gap.
// Only the cards take the pointer.
const regionStyles = css({
  "& > *": {
    pointerEvents: "auto",
  },
  inlineSize: "min({spacing.96}, calc(100% - {spacing.6}))",
  insetInlineEnd: 3,
  marginBlockStart: 2,
  position: "absolute",
});
