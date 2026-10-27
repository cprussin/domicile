import type { createHandle } from "@domicile-desktop/component-library/Popover";
import { useProvided } from "@domicile-desktop/manganese-host/use-provided";
import { createContext } from "react";

/** What opens the notification drawer from any bar's bell. */
export type NotificationsHandle = ReturnType<typeof createHandle>;

/** The notification drawer, for the bell that opens it. */
export type NotificationsDrawer = {
  /** Opens the drawer under the bell pressed. */
  handle: NotificationsHandle;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
};

export const NotificationsContext = createContext<
  NotificationsDrawer | undefined
>(undefined);

/** The drawer from {@link NotificationsContext}. */
export const useNotificationsDrawer = (): NotificationsDrawer =>
  useProvided(NotificationsContext, "the notifications (NotificationsContext)");

/** The id of the bell on monitor `screen`, which the drawer opens under. */
export const bellId = (screen: string) => `notifications-bell-${screen}`;

/**
 * The monitor of `bell`, a pressed bell, from its `data-bell-screen`. Throws
 * for anything else.
 */
export const screenOfBell = (bell: Element | undefined): string => {
  const screen = bell?.getAttribute("data-bell-screen");
  if (screen === undefined || screen === null) {
    throw new Error("The notification drawer opened from something not a bell");
  } else {
    return screen;
  }
};
