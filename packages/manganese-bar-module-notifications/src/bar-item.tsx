import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useNotificationsDrawer } from "@domicile-desktop/manganese-notifications/notifications-context";
import { NotificationBell } from "./NotificationBell";

/** The bell, which opens the notification drawer. */
export const Notifications = () => {
  const { screen } = useBar();
  const { open, unread } = useNotificationsDrawer();
  return (
    <NotificationBell
      onOpen={() => {
        open(screen);
      }}
      unread={unread}
    />
  );
};
