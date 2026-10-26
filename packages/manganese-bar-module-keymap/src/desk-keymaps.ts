import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";

import { hostKeymaps } from "./host-keymaps";

/** The keymaps, watched once for every bar, the lock screen and the toast. */
export const deskKeymaps = perDesktop(
  (domicile): SharedWatch<Keymaps> =>
    sharedWatch((onKeymaps) => hostKeymaps(domicile).watch(onKeymaps)),
);
