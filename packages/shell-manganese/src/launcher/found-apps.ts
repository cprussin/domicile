// The applications and bookmarks the host found for the launcher's box, as
// the launcher draws them.

import type {
  DomicileAppSearch,
  DomicileBookmark,
  DomicileDesktopEntry,
} from "@domicile-desktop/sdk/domicile-host";

/** An application a desktop entry offers. */
export type DesktopEntry = {
  /** The desktop file ID: its path under `applications/`, `/` read as `-`. */
  id: string;
  name: string;
  /** What the entry says it is for, or empty for an entry that says nothing. */
  comment: string;
  /** The argv it runs, for the host's `spawn`. */
  command: readonly string[];
  /** The icon it names, as a `data:` URL, or `undefined` for none found. */
  icon: string | undefined;
  /** The picture it names for a launcher's preview, likewise. */
  preview: string | undefined;
};

/** A URL the desk offers by name. */
export type Bookmark = {
  name: string;
  url: string;
  /** The icon its site names, as a `data:` URL, or `undefined` for none found. */
  icon: string | undefined;
};

/** What a search for applications offers: the applications and bookmarks. */
export type FoundApps = {
  apps: readonly DesktopEntry[];
  bookmarks: readonly Bookmark[];
};

/** The host's answer, with the engine's empty picture read as none. */
export const foundAppsOf = ({
  apps,
  bookmarks,
}: DomicileAppSearch): FoundApps => ({
  apps: apps.map(entryOf),
  bookmarks: bookmarks.map(bookmarkOf),
});

const entryOf = (entry: DomicileDesktopEntry): DesktopEntry => ({
  command: entry.command,
  comment: entry.comment,
  icon: named(entry.icon),
  id: entry.id,
  name: entry.name,
  preview: named(entry.preview),
});

const bookmarkOf = (bookmark: DomicileBookmark): Bookmark => ({
  icon: named(bookmark.icon),
  name: bookmark.name,
  url: bookmark.url,
});

/** The engine's one spelling of nothing found: the empty string. */
const named = (picture: string): string | undefined =>
  picture === "" ? undefined : picture;
