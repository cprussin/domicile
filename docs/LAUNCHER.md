# The launcher

The launcher searches three sources: files in your home directory, installed
desktop entries, and bookmarks from your config. A config reload applies
changes.

## Files

The compositor indexes your home directory at startup and watches it for
changes.
`files.omit` lists paths to leave out.

```json
{ "files": { "omit": ["*/*", "!Scratch/*"] } }
```

- Patterns are globs relative to your home directory, with gitignore rules: `*`
  stops at `/`, `**` does not, `!` re-includes, and the last match wins.
- The default is `["**/.*"]`, which hides dotfiles at any depth. Setting
  `files.omit` replaces the default.
- An omitted directory is not walked or watched, so `!` cannot re-include
  anything under it.
- Symlinks are listed by name but not followed.
- A reload walks the home directory again. The launcher keeps its old list
  until the walk finishes.

## Applications

The launcher lists the machine's desktop entries. `applications.omit` hides
some, using the same glob rules over desktop file IDs (`firefox.desktop`).

```json
{ "applications": { "omit": ["*", "!launcher-*"] } }
```

- Unset shows every entry.
- `Icon` is drawn beside the row.
- `X-Domicile-Preview` names a PNG or SVG under 128 KiB, found the same way as
  `Icon`. It fills the preview while the row is highlighted.

```ini
[Desktop Entry]
Type=Application
Name=Agenda
Exec=agenda
Icon=/path/to/agenda.svg
X-Domicile-Preview=/path/to/agenda-preview.svg
```

## Bookmarks

`applications.bookmarks` adds web pages to the launcher. Selecting one opens it
as a browser window in the shell.

```json
{
  "applications": {
    "bookmarks": [
      { "name": "Calendar - Home", "url": "https://calendar.google.com?authuser=me@home.example" },
      { "name": "Calendar - Work", "url": "https://calendar.google.com?authuser=me@work.example" }
    ]
  }
}
```

- Each bookmark has one `http` or `https` URL. Other schemes are rejected.
- The compositor fetches each site's icon when it reads the config: the page's
  `<link rel="icon">`, else `/favicon.ico`.
- A failed fetch retries after a minute, so icons appear once the network is
  up.
- The fetch sends no cookies, so sites behind a sign-in may show a placeholder
  glyph.
- Highlighting the row loads the signed-in page. Its icon then replaces the
  glyph.
