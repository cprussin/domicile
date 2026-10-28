import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useNotificationsDrawer } from "@domicile-desktop/manganese-notifications/notifications-context";
import { NotificationBell } from "./NotificationBell";

/** The bell, which opens the notification drawer under itself. */
export const Notifications = () => {
  const { screen } = useBar();
  const { doNotDisturb, handle, unread } = useNotificationsDrawer();
  return (
    <NotificationBell
      doNotDisturb={doNotDisturb}
      handle={handle}
      screen={screen}
      unread={unread}
    />
  );
};
