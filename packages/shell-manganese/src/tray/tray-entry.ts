import type { Extension } from "@domicile/chrome-sdk/extension";
import type { TrayItem } from "@domicile/chrome-sdk/tray";

import { shownInTray } from "../extensions/shown";
import { arrange } from "./tray-order";

/** What an icon on the tray is: an application's, or an extension's. */
export enum TrayEntryKind {
  Extension,
  StatusNotifier,
}

/**
 * One icon on the tray, with the key its place is remembered by.
 *
 * **The key outlives the icon**, which is the point of it: an application
 * closed and opened again, or an extension turned off and on, comes back where
 * the user put it. An extension's id is its own for good. An application's
 * `id` is not — it is the bus name the application answered on this time — so
 * its key is its title, which is the nearest thing to a name the compositor
 * sends. An application that retitles its icon, as a network indicator does
 * when the connection changes, is a new icon to the order.
 */
export const TrayEntry = {
  Extension: (extension: Extension) => ({
    extension,
    key: `extension:${extension.id}`,
    kind: TrayEntryKind.Extension as const,
  }),
  StatusNotifier: (item: TrayItem) => ({
    item,
    key: `status-notifier:${item.title}`,
    kind: TrayEntryKind.StatusNotifier as const,
  }),
};

export type TrayEntry = ReturnType<(typeof TrayEntry)[keyof typeof TrayEntry]>;

/**
 * Every icon the tray draws, in the user's `order`: the applications' and then
 * the extensions' where it has placed neither.
 */
export const trayEntries = (
  items: readonly TrayItem[],
  extensions: readonly Extension[],
  order: readonly string[],
): readonly TrayEntry[] =>
  arrange(
    [
      ...items.map((item) => TrayEntry.StatusNotifier(item)),
      ...shownInTray(extensions).map((extension) =>
        TrayEntry.Extension(extension),
      ),
    ],
    ({ key }) => key,
    order,
  );
