import type { ToastManager } from "@domicile-desktop/component-library/Toaster";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { useCallback, useEffect, useRef, useState } from "react";

import { arrivals } from "./arrivals";
import { toastTimeout } from "./toast-timeout";

export type NotificationCenter = {
  /** Every notification nobody has cleared, newest first. */
  items: readonly Notification[];
  /** How many arrived since the drawer was last opened. */
  unread: number;
  /** The drawer opened: everything in it has been seen. */
  read: () => void;
  /** Clear `ids`, which their applications are told. */
  dismiss: (ids: readonly number[]) => void;
  /** Press `action` on `id` — `"default"` for the notification itself. */
  invoke: (id: number, action: string) => void;
};

/** Where the desk's notifications are and what they have to say. */
type Desk = {
  /** As the compositor sent them: oldest first. */
  items: readonly Notification[];
  /**
   * The latest `time` the user has seen, or `undefined` before the first
   * list: that list is the history, and is seen by being the history.
   */
  readUpTo: number | undefined;
};

/**
 * The desk's notifications, the toasts for the ones that just arrived, and
 * what has not been seen yet.
 *
 * `useTray`'s shape, and registered once for the whole desk for its reason:
 * pushed, whole, on every change and once more to a page that has just
 * connected. The list is the compositor's, so a reload keeps it; which of it is
 * new is this page's to tell — see `arrivals` — and a reload toasts nothing.
 *
 * **A toast is a notification interrupting**, and nothing more: the toasts are
 * `toasts`', closed by the user or their timeout without the notification
 * going anywhere. It leaves when it is cleared — here or on another page —
 * or its application closes it, and its toast goes with it.
 */
export const useNotifications = (
  domicile: DomicileClient,
  toasts: ToastManager,
): NotificationCenter => {
  const [desk, setDesk] = useState<Desk>({
    items: [],
    readUpTo: undefined,
  });
  // The list the page was last told, for `arrivals` to tell news by. A ref,
  // because the toasting it decides is done in the handler that hears the
  // next list rather than drawn from.
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
