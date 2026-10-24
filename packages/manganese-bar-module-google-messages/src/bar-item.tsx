import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { useEffect, useSyncExternalStore } from "react";

import { deskMessages } from "./desk-messages";
import { Messages } from "./Messages";

/**
 * Google Messages in a panel, with a count of its unread conversations. Not
 * in the default bar.
 *
 * The page stays loaded while the panel is closed, so its notifications keep
 * coming and its count stays current. One bar draws it; every bar's item
 * opens it.
 */
export const GoogleMessages = () => {
  const { screen } = useBar();
  const desk = deskMessages(useDomicile());
  useEffect(() => desk.bars.show(screen), [desk, screen]);
  const drawer = useSyncExternalStore(desk.bars.subscribe, desk.bars.drawer);
  const unread = useSyncExternalStore(
    desk.unread.subscribe,
    desk.unread.current,
  );
  return (
    <Messages
      drawsPage={drawer === screen}
      handle={desk.handle}
      onUnread={desk.unread.set}
      screen={screen}
      unread={unread}
    />
  );
};
