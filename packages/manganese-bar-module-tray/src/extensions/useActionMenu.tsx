import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import { AppMenuEntries } from "@domicile-desktop/manganese-window-management/browser/AppMenuBar";
import type { AppMenuEntry } from "@domicile-desktop/sdk/app-menu";
import { MenuEntryKind } from "@domicile-desktop/sdk/dbusmenu";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Extension } from "@domicile-desktop/sdk/extension";
import type { ReactNode } from "react";
import { useState } from "react";

export type ActionMenu = {
  /** The open menu, to render, or `undefined` while it is closed. */
  opened: ReactNode;
  /**
   * Reads the items `extension` adds to its action's menu
   * (`chrome.contextMenus`) and opens them with their corner at `at`, or
   * nothing when it adds none.
   */
  show: (at: Point) => void;
};

/**
 * An extension action's menu, for its icon in the tray and its row in the
 * tray's menu alike.
 */
export const useActionMenu = (
  domicile: Domicile,
  { id, name }: Extension,
): ActionMenu => {
  const [menu, setMenu] = useState<
    { at: Point; entries: readonly AppMenuEntry[] } | undefined
  >(undefined);
  return {
    opened: menu !== undefined && (
      <ContextMenu
        at={menu.at}
        label={name}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(undefined);
          }
        }}
        open
      >
        <AppMenuEntries
          entries={menu.entries}
          onChoose={(item) => {
            domicile.extensions.runMenuItem(item);
          }}
        />
      </ContextMenu>
    ),
    show: (at) => {
      domicile.extensions
        .menu(id)
        .then((entries) => {
          setMenu(
            entries.length === 0 ? undefined : { at, entries: flat(entries) },
          );
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: the menu stays shut; say why
          console.error(`Could not read ${name}'s menu`, error);
        });
    },
  };
};

/**
 * `entries`, or the entries of the one submenu they hold. Extensions such as
 * Bitwarden put every item under one named after themselves, which the menu
 * already is.
 */
const flat = (entries: readonly AppMenuEntry[]): readonly AppMenuEntry[] => {
  const [only] = entries;
  return entries.length === 1 &&
    only?.kind === MenuEntryKind.Item &&
    only.submenu !== undefined
    ? only.submenu
    : entries;
};
