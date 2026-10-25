// The system tray, whose icons are applications' StatusNotifierItems. See
// docs/architecture/SYSTEM-TRAY.md.

import type { Result } from "@cprussin/option-result";
import type { MenuAddress, MenuEntry, WatchedMenu } from "../dbusmenu";
import { watchMenu } from "../dbusmenu";
import type { DomicileHost, DomicileTrayItem } from "../domicile-host";
import type { SystemError } from "../system";
import type { TrayAction, TrayItem } from "../tray";
import type { Dbus } from "./dbus";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type TrayListeners = {
  change: () => void;
};

export type Tray = {
  /** `undefined` until the compositor says. */
  readonly items: readonly TrayItem[] | undefined;
  /** Click icon `id` with a button. What the click does is the application's. */
  activate: (id: string, action: TrayAction) => void;
  /** Call `onMenu` with the menu at `address` now and after each change. */
  menu: (
    address: MenuAddress,
    onMenu: (menu: Result<readonly MenuEntry[], SystemError>) => void,
  ) => WatchedMenu;
  on: On<TrayListeners>;
};

export type TrayHost = Pick<
  DomicileHost,
  "activateTrayItem" | "addEventListener" | "removeEventListener" | "tray"
>;

export const tray = (
  host: TrayHost,
  bus: Pick<Dbus, "call" | "match">,
): Tray => {
  const itemsOf = memoizeLast((list: readonly DomicileTrayItem[] | null) =>
    list?.map(itemOf),
  );
  return {
    activate: (id, action) => {
      host.activateTrayItem(id, action);
    },
    get items() {
      return itemsOf(host.tray);
    },
    menu: (address, onMenu) => watchMenu({ dbus: bus }, address, onMenu),
    on: on<TrayListeners>({
      change: (listener) => hostEvent(host, "traychanged", () => listener()),
    }),
  };
};

/** The engine sends `""` for an icon it could not render and for no menu. */
const itemOf = (item: DomicileTrayItem): TrayItem => ({
  bus: item.bus,
  icon: item.icon === "" ? undefined : item.icon,
  id: item.id,
  itemIsMenu: item.itemIsMenu,
  menu: item.menu === "" ? undefined : item.menu,
  title: item.title,
});
