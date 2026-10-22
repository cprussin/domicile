import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import { useEffect, useSyncExternalStore } from "react";

import { deskMessages } from "./desk-messages";
import { Messages } from "./Messages";

const NONE: readonly number[] = [];

/**
 * Google Messages in a panel, with a count of its new messages. Not in the
 * default bar.
 *
 * The page stays loaded while the panel is closed, so its notifications keep
 * coming. One bar draws it; every bar's item opens it.
 */
export const GoogleMessages = () => {
  const domicile = useDomicile();
  const { screen } = useBar();
  const desk = deskMessages(domicile);
  useEffect(() => desk.bars.show(screen), [desk, screen]);
  const drawer = useSyncExternalStore(desk.bars.subscribe, desk.bars.drawer);
  const unread = useSharedWatch(desk.notifications) ?? NONE;
  return (
    <Messages
      drawsPage={drawer === screen}
      handle={desk.handle}
      onOpen={() => {
        domicile.dismissNotifications(unread);
      }}
      screen={screen}
      unread={unread.length}
    />
  );
};
