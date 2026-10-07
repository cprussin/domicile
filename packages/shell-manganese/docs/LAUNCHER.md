# The launcher

**Meta+Space** (or Meta+D, or the bar's launcher button) opens a search box.
Every row is something Enter can do. Source: `src/launcher/`.

## Rows, in order

1. For a `!` tag (`!wiki`, `!yt`, …): the tagged site's page for the words, if
   it has one, then a search on that site, with its logo. `!gh` with a name
   (`cprussin` or `cprussin/domicile`) goes to that GitHub page.
2. A URL, if the line is one.
3. Applications and bookmarks (the `applications` option), as one list by
   name.
4. A path, if the line is spelled like one.
5. Files from the compositor's index of the home directory.
6. A Google search for the line as typed. Always present.

`src/address/typed-address.ts` decides whether a line is a site or a search.
Browser address bars use the same rule.

## Sources

- **Applications**: `@domicile-desktop/system-apps` reads desktop entries
  through the system calls (`launcher/app-search.ts`). Icons come from the
  `hicolor` theme. Entries are read while the launcher is closed, so rows
  don't shift when it opens; typing searches that list.
- **Bookmarks**: open as a page. The icon is the one the page named when last
  previewed or visited, else the one `system-apps` fetched with `curl`.
- **Files**: the compositor's index matches the query and returns the top
  results. While indexing is unfinished, the panel says so and re-queries.

## Preview

A preview of the highlighted row sits beside the list. It updates once typing
settles, and keeps the last preview until then.

- **Text file**: the start of the file, highlighted with `lowlight` in the
  theme's colors.
- **Folder**: a grid of its contents; images show as thumbnails.
- **Audio**: tags and cover art, over a player. Told by content, not name:
  ID3v2 (MP3, WAV, AIFF), FLAC, Ogg Vorbis and Opus, MP4.
- **Video**: one frame from 10% in.
- **Image or PDF**: loaded from `domicile://home/`.
- **URL**: the page.
- **Application**: the image named by `X-Domicile-Preview`, or else its
  description and the command Enter runs.

## Behavior

- The highlight starts on the first row. The pointer moves it.
- While the launcher is open, other bindings are ignored. See
  [Keys](KEYS.md#commands).
