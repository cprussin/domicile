// The tray's menu listing 40 applications' icons, every one kept out of the
// tray.

import { Tray } from "@domicile-desktop/manganese-bar-module-tray";
import type { TrayState } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { TrayContext } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { statusNotifierKey } from "@domicile-desktop/manganese-bar-module-tray/tray-entry";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { Bar } from "../Bar";

const ITEMS = Array.from({ length: 40 }, (_, index) => ({
  bus: `:1.${index.toString()}`,
  icon: undefined,
  id: `app-${index.toString()}`,
  itemIsMenu: false,
  menu: undefined,
  title: `App ${(index + 1).toString()}`,
}));

const nothing = () => undefined;

const TRAY: TrayState = {
  clicked: nothing,
  extensions: [],
  installed: [],
  items: ITEMS,
  open: nothing,
  opened: undefined,
  order: { move: nothing, order: [] },
  pins: {
    pin: nothing,
    unpin: nothing,
    unpinned: new Set(ITEMS.map(({ id }) => statusNotifierKey(id))),
  },
  profile: undefined,
};

export const TrayScene = () => (
  <DomicileProvider domicile={desktop(new FakeDomicileHost().host)}>
    <TrayContext value={TRAY}>
      <Bar>
        <Tray />
      </Bar>
    </TrayContext>
  </DomicileProvider>
);
