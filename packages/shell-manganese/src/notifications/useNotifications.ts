import type { ToastManager } from "@domicile-desktop/component-library/Toaster";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { useCallback, useEffect, useRef, useState } from "react";

import { arrivals } from "./arrivals";
import { toastTimeout } from "./toast-timeout";

export type NotificationCenter = {
  /** Every uncleared notification, newest first. */
  items: readonly Notification[];
  /** How many arrived since the drawer was last opened. */
  unread: number;
  /** Mark everything as seen; called when the drawer opens. */
  read: () => void;
  /** Clear `ids` and tell their applications. */
  dismiss: (ids: readonly number[]) => void;
  /** Press `action` on `id`; `"default"` for the notification itself. */
  invoke: (id: number, action: string) => void;
};

/** The notifications and how far the user has read. */
type Desk = {
  /** As the compositor sent them: oldest first. */
  items: readonly Notification[];
  /**
   * The latest `time` the user has seen, or `undefined` before the first list,
   * which counts as seen.
   */
  readUpTo: number | undefined;
};

/**
 * The desktop's notifications, toasts for new arrivals, and the unseen count.
 *
 * Like `useTray`, it registers once for the whole desktop and receives the full
 * list on every change and on connect. The compositor owns the list, so it
 * survives a reload; `arrivals` decides what is new, so a reload toasts
 * nothing.
 *
 * A toast only interrupts. Closing it or timing out leaves the notification in
 * place. Clearing the notification (on any page) or its application closing it
 * removes the toast too. See docs/architecture/NOTIFICATIONS.md.
 */
export const useNotifications = (
  domicile: DomicileClient,
  toasts: ToastManager,
): NotificationCenter => {
  const [desk, setDesk] = useState<Desk>({
    items: [],
    readUpTo: undefined,
  });
  // The last list received, for `arrivals`. A ref because it is only used in
  // the handler, not for rendering.
  const told = useRef<readonly Notification[] | undefined>(undefined);

  useEffect(() => {
    domicile.on("notifications", ({ items }) => {
      for (const arrived of arrivals(told.current, items)) {
        toasts.add({
          data: arrived,
          description: arrived.body,
          id: String(arrived.id),
          timeout: toastTimeout(arrived),
          title: arrived.summary,
          type: arrived.urgency === "critical" ? "danger" : undefined,
        });
      }
      for (const gone of (told.current ?? []).filter(
        ({ id }) => !items.some((item) => item.id === id),
      )) {
        toasts.close(String(gone.id));
      }
      told.current = items;
      setDesk((previous) => ({
        items,
        readUpTo: previous.readUpTo ?? latest(items),
      }));
    });
  }, [domicile, toasts]);

  const read = useCallback(() => {
    setDesk((previous) => ({ ...previous, readUpTo: latest(previous.items) }));
  }, []);

  const dismiss = useCallback(
    (ids: readonly number[]) => {
      domicile.dismissNotifications(ids);
    },
    [domicile],
  );

  const invoke = useCallback(
    (id: number, action: string) => {
      domicile.invokeNotificationAction(id, action);
    },
    [domicile],
  );

  return {
    dismiss,
    invoke,
    items: desk.items.toReversed(),
    read,
    unread: desk.items.filter(({ time }) => time > (desk.readUpTo ?? 0)).length,
  };
};

/** The newest `time` in `items`, or `0` for none. */
const latest = (items: readonly Notification[]): number =>
  Math.max(0, ...items.map(({ time }) => time));
