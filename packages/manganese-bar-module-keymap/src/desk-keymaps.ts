import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";

import { hostKeymaps } from "./host-keymaps";

/** The keymaps, watched once for every bar, the lock screen and the toast. */
export const deskKeymaps = perHost(
  (domicile): SharedWatch<Keymaps> =>
    sharedWatch((onKeymaps) => hostKeymaps(domicile).watch(onKeymaps)),
);
