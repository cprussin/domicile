import { createContext } from "react";

import { useProvided } from "../host/use-provided";

/** The notification drawer, for the bell that opens it. */
export type NotificationsDrawer = {
  /** Open the drawer on monitor `screen`. */
  open: (screen: string) => void;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
};

export const NotificationsContext = createContext<
  NotificationsDrawer | undefined
>(undefined);

/** The drawer from {@link NotificationsContext}. */
export const useNotificationsDrawer = (): NotificationsDrawer =>
  useProvided(NotificationsContext, "the notifications (NotificationsContext)");
