// The notification drawer holding 40 notifications. Another arrives on the
// window's `crowd:arrive` event.

import { createHandle } from "@domicile-desktop/component-library/Popover";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";
import { NotificationDrawer } from "@domicile-desktop/manganese-notifications/NotificationDrawer";
import { NotificationsContext } from "@domicile-desktop/manganese-notifications/notifications-context";
import type { Notification } from "@domicile-desktop/sdk/notification";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

import { Bar } from "../Bar";

const COUNT = 40;

/** Notification `id`, from Firefox. */
const notification = (id: number): Notification => ({
  actions: [],
  appName: "Firefox",
  body: "Can you look at the draft before the meeting?",
  browserWindow: undefined,
  clickable: false,
  icon: undefined,
  id,
  summary: `Message ${id.toString()}`,
  time: 0,
  timeoutMs: undefined,
  urgency: "normal",
});

const NOTIFICATIONS = Array.from(
  { length: COUNT },
  (_, index): Notification => notification(COUNT - index),
);

const DRAWER = { handle: createHandle(), paused: false, unread: 0 };

export const NotificationsScene = () => {
  const [screen, setScreen] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly Notification[]>(NOTIFICATIONS);
  useEffect(() => {
    const arrive = () => {
      setItems((shown) => [notification(shown.length + 1000), ...shown]);
    };
    window.addEventListener("crowd:arrive", arrive);
    return () => {
      window.removeEventListener("crowd:arrive", arrive);
    };
  }, []);
  const [pause, setPause] =
    useState<ComponentProps<typeof NotificationDrawer>["pause"]>(undefined);
  return (
    <NotificationsContext value={DRAWER}>
      <Bar>
        <Notifications />
      </Bar>
      <NotificationDrawer
        handle={DRAWER.handle}
        items={items}
        now={0}
        onAction={ignored}
        onClose={() => {
          setScreen(undefined);
        }}
        onDismiss={(ids) => {
          setItems((shown) => shown.filter(({ id }) => !ids.includes(id)));
        }}
        onOpen={setScreen}
        onPause={() => {
          setPause({});
        }}
        onReply={ignored}
        onResume={() => {
          setPause(undefined);
        }}
        open={screen !== undefined}
        pause={pause}
        screen={screen}
      />
    </NotificationsContext>
  );
};

const ignored = () => undefined;
