// The tray's menu listing 40 applications' icons, every one kept out of the
// tray, and extensions with long names, some switched on in the profile.

import { Tray } from "@domicile-desktop/manganese-bar-module-tray";
import type { TrayState } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { TrayContext } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { statusNotifierKey } from "@domicile-desktop/manganese-bar-module-tray/tray-entry";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import type { BrowserProfile } from "@domicile-desktop/sdk/desktop/browser";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { InstalledExtension } from "@domicile-desktop/sdk/extension";
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

const ICON = "data:image/png;base64,iVBORw0KGgo=";

/** Ten extensions with long names; the odd ones switched on. */
const INSTALLED: InstalledExtension[] = Array.from(
  { length: 10 },
  (_, index) => ({
    configured: ["siteAccess"],
    enabled: index % 2 === 1,
    fileAccess: false,
    fromConfig: true,
    icon: ICON,
    id: String.fromCharCode(97 + index).repeat(32),
    name: `Extension ${(index + 1).toString()} – A Name Longer Than Its Row`,
    optionsUrl: undefined,
    siteAccess: "on_click",
    sites: [],
    userScripts: undefined,
  }),
);

const ON = INSTALLED.filter(({ enabled }) => enabled);

const PROFILE: BrowserProfile = {
  color: "#06b6d4",
  configSites: [],
  enabledExtensions: ON.map(({ id }) => id),
  extensions: INSTALLED.map(({ id }) => id),
  id: "default",
  isDefault: true,
  isDefaultPrivate: false,
  isPrivate: false,
  lockedExtensions: INSTALLED.map(({ id }) => id),
  name: "Default",
  pinnedSites: [],
};

const nothing = () => undefined;

const TRAY: TrayState = {
  clicked: nothing,
  extensions: ON.map(({ icon, id, name }) => ({
    badgeColor: "#00000000",
    badgeText: "",
    enabled: true,
    icon,
    id,
    name,
    popup: undefined,
    profile: PROFILE.id,
    title: name,
  })),
  installed: INSTALLED,
  items: ITEMS,
  open: nothing,
  opened: undefined,
  order: { move: nothing, order: [] },
  pins: {
    pin: nothing,
    unpin: nothing,
    unpinned: new Set(ITEMS.map(({ id }) => statusNotifierKey(id))),
  },
  profile: PROFILE,
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
