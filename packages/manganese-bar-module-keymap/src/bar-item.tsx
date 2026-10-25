import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { KeymapChoice } from "@domicile-desktop/sdk/keymap-choice";
import { system } from "@domicile-desktop/sdk/system";
import { use, useCallback } from "react";

import { deskKeymaps } from "./desk-keymaps";
import { Keymap as Item } from "./Keymap";
import { KeymapOptionsContext } from "./keymap-options";

/**
 * The keymap the desktop types on, and a list to switch it. Shows only for a
 * keyboard with several `keymaps`. Works while locked, so the passphrase is
 * typed on the right one.
 */
export const Keymap = () => {
  const domicile = useDomicile();
  const { hideDefault } = use(KeymapOptionsContext);
  const select = useCallback(
    (name: string) => {
      system(domicile)
        .selectKeymap(KeymapChoice.Named(name))
        .then((result) => {
          result.match({ Err: logFailure, Ok: () => undefined });
        })
        .catch(logFailure);
    },
    [domicile],
  );
  return (
    <Item
      hideDefault={hideDefault}
      keymaps={deskKeymaps(domicile)}
      onSelect={select}
    />
  );
};

const logFailure = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the item shows the keymap the desktop kept
  console.error("could not switch the keymap", error);
};
