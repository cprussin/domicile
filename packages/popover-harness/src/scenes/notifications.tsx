// The notification drawer holding 40 notifications.

import { createHandle } from "@domicile-desktop/component-library/Popover";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";
import { NotificationDrawer } from "@domicile-desktop/manganese-notifications/NotificationDrawer";
import { NotificationsContext } from "@domicile-desktop/manganese-notifications/notifications-context";
import type { Notification } from "@domicile-desktop/sdk/notification";
import type { ComponentProps } from "react";
import { useState } from "react";

import { Bar } from "../Bar";

const COUNT = 40;

const NOTIFICATIONS = Array.from(
  { length: COUNT },
  (_, index): Notification => ({
    actions: [],
    appName: "Firefox",
    body: "Can you look at the draft before the meeting?",
    browserWindow: undefined,
    clickable: false,
    icon: undefined,
    id: COUNT - index,
    summary: `Message ${(COUNT - index).toString()}`,
    time: 0,
    timeoutMs: undefined,
    urgency: "normal",
  }),
);

const DRAWER = { handle: createHandle(), paused: false, unread: 0 };

export const NotificationsScene = () => {
  const [screen, setScreen] = useState<string | undefined>(undefined);
  const [pause, setPause] =
    useState<ComponentProps<typeof NotificationDrawer>["pause"]>(undefined);
  return (
    <NotificationsContext value={DRAWER}>
      <Bar>
        <Notifications />
      </Bar>
      <NotificationDrawer
        handle={DRAWER.handle}
        items={NOTIFICATIONS}
        now={0}
        onAction={ignored}
        onClose={() => {
          setScreen(undefined);
        }}
        onDismiss={ignored}
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
